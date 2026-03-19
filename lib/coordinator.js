'use strict';

const { EventEmitter } = require('events');
const {
  GROUP_LIGHT, GROUP_SHADE, GROUP_HEATING, GROUP_JOKER,
  SCENE_OFF, SCENE_1,
  SCENE_PRESENT, SCENE_ABSENT, SCENE_SLEEPING, SCENE_WAKEUP, SCENE_STANDBY, SCENE_DEEP_OFF,
  SCENE_RAIN,
  PRESENCE_SCENES, ALARM_SCENES,
  SENSOR_TEMPERATURE, SENSOR_HUMIDITY, SENSOR_BRIGHTNESS, SENSOR_CO2,
  POLL_INTERVAL, EVENT_SUBSCRIPTION_ID,
  RECONNECT_INITIAL, RECONNECT_MAX,
  DssAuthError,
} = require('./dss-client');

/**
 * Coordinator for Digital Strom data.
 * Manages event subscriptions, polling, and state tracking.
 * Port of coordinator.py from ha-digitalstrom-smart.
 */
class DssCoordinator extends EventEmitter {
  /**
   * @param {import('./dss-client').DssClient} api
   * @param {object} structure - Result from api.getStructure()
   * @param {object} options
   * @param {string} options.dssId - dSS unique ID
   * @param {Function} options.logger - Log function
   */
  constructor(api, structure, options = {}) {
    super();
    this.api = api;
    this.dssId = options.dssId || '';
    this.log = options.logger || console.log;
    this.proEnabled = false;

    // Parsed structure
    this.zones = {};
    this.devices = {};
    this._parseStructure(structure);

    // State storage
    this._zoneStates = {};       // {`${zoneId}-${group}`} → {scene, value, isOn}
    this._consumption = 0;
    this._temperatures = {};     // {zoneId} → {TemperatureValue, NominalValue, ControlValue, ...}
    this._outdoorSensors = {};   // {type} → {value}
    this._zoneSensors = {};      // {zoneId} → {sensorType → value}
    this._deviceSensorValues = {}; // {dsuid} → {sensorType → value}
    this._circuitPower = {};     // {dsuid} → watts
    this._deviceOnStates = {};   // {dsuid} → bool

    // Climate (Pro)
    this._climateStatus = {};    // {zoneId} → status
    this._climateConfig = {};    // {zoneId} → config
    this._heatingSystemCooling = false;

    // Apartment state (Pro)
    this._apartmentPresence = null;
    this._apartmentAlarms = new Set();

    // Scene discovery
    this.sceneNames = {};        // {`${zoneId}-${group}-${sceneNr}`} → name
    this.reachableScenes = {};   // {`${zoneId}-${group}`} → [sceneNr, ...]

    // Event loop state
    this._eventLoopRunning = false;
    this._pollTimer = null;
    this._reconnectDelay = RECONNECT_INITIAL;
  }

  // --- Structure Parsing ---

  _parseStructure(structure) {
    const apartment = structure.apartment || structure;
    const zones = apartment.zones || [];

    for (const zone of zones) {
      const zoneId = zone.id;
      if (zoneId <= 0 || zoneId >= 65534) continue;

      const groups = new Set();
      for (const group of (zone.groups || [])) {
        if (group.devices && group.devices.length > 0) {
          groups.add(group.group);
        }
      }

      const deviceList = [];
      for (const device of (zone.devices || [])) {
        const dsuid = device.dSUID || device.id;
        const outputMode = device.outputMode || 0;
        const binaryInputs = (device.binaryInputs || []);
        const sensors = (device.sensors || []);
        const deviceGroups = (device.groups || []).map(g => g.group || g);

        this.devices[dsuid] = {
          dsuid,
          name: device.name || `Device ${dsuid.substring(0, 8)}`,
          zoneId,
          zoneName: zone.name,
          hwInfo: device.hwInfo || '',
          isOn: device.isOn || false,
          outputMode,
          binaryInputs,
          groups: deviceGroups,
          sensors,
        };

        // Initialize on/off state for Joker devices
        if (deviceGroups.includes(GROUP_JOKER)) {
          this._deviceOnStates[dsuid] = device.isOn || false;
        }

        deviceList.push(dsuid);
      }

      this.zones[zoneId] = {
        id: zoneId,
        name: zone.name || `Zone ${zoneId}`,
        groups,
        deviceCount: deviceList.length,
        devices: deviceList,
      };
    }

    this.log(`Parsed structure: ${Object.keys(this.zones).length} zones, ${Object.keys(this.devices).length} devices`);
  }

  // --- Scene Discovery ---

  async fetchSceneNames() {
    for (const [zoneId, zone] of Object.entries(this.zones)) {
      for (const group of zone.groups) {
        if (![GROUP_LIGHT, GROUP_SHADE, GROUP_HEATING].includes(group)) continue;

        try {
          const result = await this.api.getReachableScenes(parseInt(zoneId), group);
          const scenes = result.reachableScenes || [];
          const names = result.userSceneNames || [];

          this.reachableScenes[`${zoneId}-${group}`] = scenes;

          for (const nameEntry of names) {
            if (nameEntry.sceneName) {
              this.sceneNames[`${zoneId}-${group}-${nameEntry.sceneNr}`] = nameEntry.sceneName;
            }
          }
        } catch (err) {
          this.log(`Failed to get scenes for zone ${zoneId} group ${group}: ${err.message}`);
        }
      }
    }
  }

  // --- Initial State ---

  async fetchInitialStates() {
    for (const [zoneId, zone] of Object.entries(this.zones)) {
      for (const group of zone.groups) {
        if (![GROUP_LIGHT, GROUP_SHADE, GROUP_HEATING, GROUP_JOKER].includes(group)) continue;

        try {
          const result = await this.api.getLastCalledScene(parseInt(zoneId), group);
          const scene = result.scene !== undefined ? result.scene : null;
          const key = `${zoneId}-${group}`;
          this._zoneStates[key] = {
            scene,
            value: null,
            isOn: scene !== null && scene !== 0,
          };
        } catch {
          // Ignore errors for initial state
        }
      }
    }
  }

  // --- Climate Data (Pro) ---

  async fetchClimateData() {
    for (const zoneId of Object.keys(this.zones)) {
      try {
        const config = await this.api.getTemperatureControlConfig(parseInt(zoneId));
        const controlMode = config.ControlMode;

        if (this._isClimateControlActive(controlMode)) {
          this._climateConfig[zoneId] = config;

          try {
            const status = await this.api.getTemperatureControlStatus(parseInt(zoneId));
            this._climateStatus[zoneId] = status;
          } catch {
            // Status fetch can fail
          }
        }
      } catch {
        // Zone has no climate control
      }
    }

    this.log(`Found ${Object.keys(this._climateConfig).length} climate zones`);
  }

  _isClimateControlActive(controlMode) {
    if (typeof controlMode === 'number') return controlMode > 0;
    if (typeof controlMode === 'string') return controlMode.length > 0;
    return false;
  }

  // --- Sensor Data ---

  async fetchSensorData() {
    try {
      const result = await this.api.getSensorValues();
      const values = result.values || result.zones || [];

      for (const entry of values) {
        if (entry.zoneID === 0 || entry.name === 'outdoor') {
          // Outdoor sensors
          for (const sensor of (entry.values || [])) {
            this._outdoorSensors[sensor.type || sensor.sensorType] = {
              value: sensor.value || sensor.sensorValueFloat || 0,
              type: sensor.type || sensor.sensorType,
            };
          }
        } else if (entry.zoneID) {
          // Zone sensors
          if (!this._zoneSensors[entry.zoneID]) {
            this._zoneSensors[entry.zoneID] = {};
          }
          for (const sensor of (entry.values || [])) {
            this._zoneSensors[entry.zoneID][sensor.type || sensor.sensorType] = sensor.value || sensor.sensorValueFloat || 0;
          }
        }
      }
    } catch (err) {
      this.log(`Failed to fetch sensor data: ${err.message}`);
    }
  }

  async fetchDeviceSensors() {
    for (const [zoneId] of Object.entries(this.zones)) {
      try {
        const result = await this.api.getZoneSensorValues(parseInt(zoneId));
        const mapping = {
          TemperatureValue: SENSOR_TEMPERATURE,
          HumidityValue: SENSOR_HUMIDITY,
          CO2concentrationValue: SENSOR_CO2,
          BrightnessValue: SENSOR_BRIGHTNESS,
        };

        for (const [field, sensorType] of Object.entries(mapping)) {
          if (result[field] !== undefined && result[field] !== null) {
            if (!this._zoneSensors[zoneId]) this._zoneSensors[zoneId] = {};
            this._zoneSensors[zoneId][sensorType] = result[field];
          }
        }
      } catch {
        // Zone may not have sensors
      }
    }
  }

  // --- Circuit Data ---

  async fetchCircuitData() {
    try {
      const result = await this.api.getCircuits();
      const circuits = result.circuits || [];

      for (const circuit of circuits) {
        if (!circuit.hwName || !circuit.hwName.startsWith('dSM')) continue;

        try {
          const meter = await this.api.getMeteringLatest(`.meters(${circuit.dsuid || circuit.dSUID})`);
          this._circuitPower[circuit.dsuid || circuit.dSUID] = meter.consumption || meter.value || 0;
        } catch {
          // Meter read can fail
        }
      }
    } catch (err) {
      this.log(`Failed to fetch circuit data: ${err.message}`);
    }
  }

  // --- Apartment State (Pro) ---

  async fetchApartmentState() {
    try {
      const result = await this.api.getLastCalledScene(0, 0);
      const scene = result.scene;
      if (PRESENCE_SCENES.includes(scene)) {
        this._apartmentPresence = scene;
      }
    } catch {
      // Ignore
    }
  }

  async callApartmentScene(scene) {
    await this.api.callScene(0, 0, scene);
  }

  async undoApartmentScene(scene) {
    await this.api.undoScene(0, 0, scene);
  }

  // --- Event Processing ---

  _processEvent(event) {
    const name = event.name;
    const props = event.properties || {};

    switch (name) {
      case 'callScene':
      case 'undoScene': {
        const zoneId = props.zoneID;
        const group = props.groupID;
        const scene = props.sceneID;
        const key = `${zoneId}-${group}`;

        if (zoneId === 0 || zoneId === '0') {
          // Apartment-level scene
          if (PRESENCE_SCENES.includes(scene)) {
            this._apartmentPresence = scene;
          }
          if (ALARM_SCENES.includes(scene)) {
            if (name === 'callScene') {
              this._apartmentAlarms.add(scene);
            } else {
              this._apartmentAlarms.delete(scene);
            }
          }
        } else {
          this._zoneStates[key] = {
            scene: name === 'callScene' ? scene : null,
            value: null,
            isOn: name === 'callScene' && scene !== 0,
          };

          // Update Joker device states
          if (group === GROUP_JOKER || group === String(GROUP_JOKER)) {
            const zone = this.zones[zoneId];
            if (zone) {
              for (const dsuid of zone.devices) {
                const device = this.devices[dsuid];
                if (device && device.groups.includes(GROUP_JOKER) && device.outputMode > 0) {
                  this._deviceOnStates[dsuid] = name === 'callScene' && scene !== 0;
                }
              }
            }
          }
        }
        break;
      }

      case 'zoneSensorValue': {
        const zoneId = props.zoneID;
        const sensorType = props.sensorType;
        const value = props.sensorValueFloat !== undefined ? props.sensorValueFloat : props.sensorValue;

        if (!this._temperatures[zoneId]) this._temperatures[zoneId] = {};
        if (sensorType === SENSOR_TEMPERATURE) {
          this._temperatures[zoneId].TemperatureValue = value;
        }
        break;
      }

      case 'deviceSensorValue': {
        const dsuid = props.dsuid;
        const sensorType = props.sensorType;
        const value = props.sensorValueFloat !== undefined ? props.sensorValueFloat : props.sensorValue;

        if (!this._deviceSensorValues[dsuid]) this._deviceSensorValues[dsuid] = {};
        this._deviceSensorValues[dsuid][sensorType] = value;
        break;
      }

      case 'stateChange': {
        // Rain detection
        if (props.stateName === 'rain' || props.name === 'rain') {
          if (props.state === 'active' || props.value === 1) {
            this._apartmentAlarms.add(SCENE_RAIN);
          } else {
            this._apartmentAlarms.delete(SCENE_RAIN);
          }
        }

        // Heating/cooling mode
        if (props.stateName === 'heating_system_mode') {
          this._heatingSystemCooling = props.state === 'cooling';
        }

        // Device state change
        if (props.dsuid) {
          this._deviceOnStates[props.dsuid] = props.state === 'active' || props.value === 1;
        }
        break;
      }
    }

    this.emit('stateChanged', { event: name, properties: props });
  }

  // --- Event Loop ---

  async startEventListener() {
    if (this._eventLoopRunning) return;

    try {
      await this.api.subscribeEvents();
      this._eventLoopRunning = true;
      this._runEventLoop();
      this.log('Event listener started');
    } catch (err) {
      this.log(`Failed to start event listener: ${err.message}`);
    }
  }

  stopEventListener() {
    this._eventLoopRunning = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _runEventLoop() {
    while (this._eventLoopRunning) {
      try {
        const result = await this.api.getEvents();
        const events = result.events || [];

        for (const event of events) {
          this._processEvent(event);
        }

        this._reconnectDelay = RECONNECT_INITIAL;
      } catch (err) {
        if (!this._eventLoopRunning) break;

        if (err instanceof DssAuthError) {
          this.log('Auth error in event loop, reconnecting...');
          try {
            await this.api.connect();
            await this.api.subscribeEvents();
            continue;
          } catch {
            // Reconnect failed
          }
        }

        this.log(`Event loop error: ${err.message}, retrying in ${this._reconnectDelay}ms`);
        await this._sleep(this._reconnectDelay);
        this._reconnectDelay = Math.min(this._reconnectDelay * 2, RECONNECT_MAX);
      }
    }
  }

  // --- Polling ---

  startPolling() {
    if (this._pollTimer) return;
    this._poll();
  }

  stopPolling() {
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async _poll() {
    try {
      // Consumption
      this._consumption = await this.api.getConsumption();

      // Temperature values
      try {
        const tempResult = await this.api.getTemperatureValues();
        const zones = tempResult.zones || [];
        for (const zone of zones) {
          this._temperatures[zone.id] = {
            TemperatureValue: zone.TemperatureValue,
            NominalValue: zone.NominalValue,
            ControlValue: zone.ControlValue,
          };
        }
      } catch {
        // Temperature polling can fail
      }

      // Circuit power
      await this.fetchCircuitData();

      // Device sensors
      await this.fetchDeviceSensors();

      // Pro features
      if (this.proEnabled) {
        await this.fetchSensorData();
        await this.fetchClimateData();
      }

      this.emit('stateChanged', { event: 'poll', properties: {} });
    } catch (err) {
      this.log(`Poll error: ${err.message}`);
    }

    if (this._eventLoopRunning || this._pollTimer !== null) {
      this._pollTimer = setTimeout(() => this._poll(), POLL_INTERVAL);
    }
  }

  // --- State Getters ---

  getZoneState(zoneId, group) {
    return this._zoneStates[`${zoneId}-${group}`] || { scene: null, value: null, isOn: false };
  }

  getConsumption() {
    return this._consumption;
  }

  getTemperature(zoneId) {
    const temps = this._temperatures[zoneId];
    return temps ? (temps.NominalValue || null) : null;
  }

  getCurrentTemperature(zoneId) {
    const temps = this._temperatures[zoneId];
    if (!temps) return null;
    return temps.TemperatureValue || temps.sensorValue || null;
  }

  getControlValue(zoneId) {
    const temps = this._temperatures[zoneId];
    return temps ? (temps.ControlValue || 0) : 0;
  }

  getOutdoorSensors() {
    return { ...this._outdoorSensors };
  }

  getZoneSensors(zoneId) {
    return this._zoneSensors[zoneId] || {};
  }

  getDeviceSensors(dsuid) {
    return this._deviceSensorValues[dsuid] || {};
  }

  getCircuitPower(dsuid) {
    return this._circuitPower[dsuid] || 0;
  }

  getDeviceOnState(dsuid) {
    return this._deviceOnStates[dsuid] || false;
  }

  getApartmentPresence() {
    return this._apartmentPresence;
  }

  getApartmentAlarms() {
    return new Set(this._apartmentAlarms);
  }

  isCoolingMode() {
    return this._heatingSystemCooling;
  }

  hasTemperatureControl(zoneId) {
    return !!this._climateConfig[zoneId];
  }

  getClimateStatus(zoneId) {
    return this._climateStatus[zoneId] || null;
  }

  getClimateConfig(zoneId) {
    return this._climateConfig[zoneId] || null;
  }

  // --- Joker Device Helpers ---

  getJokerActuators(zoneId) {
    const zone = this.zones[zoneId];
    if (!zone) return [];
    return zone.devices
      .map(dsuid => this.devices[dsuid])
      .filter(d => d && d.groups.includes(GROUP_JOKER) && d.outputMode > 0);
  }

  getJokerSensors(zoneId) {
    const zone = this.zones[zoneId];
    if (!zone) return [];
    return zone.devices
      .map(dsuid => this.devices[dsuid])
      .filter(d => d && d.groups.includes(GROUP_JOKER) && d.outputMode === 0 && d.binaryInputs.length > 0);
  }

  // --- Utility ---

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async destroy() {
    this.stopEventListener();
    this.stopPolling();
    this.removeAllListeners();
  }
}

module.exports = { DssCoordinator };
