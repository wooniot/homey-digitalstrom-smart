'use strict';

const crypto = require('crypto');
const https = require('https');
const http = require('http');

// dSS API Group IDs
const GROUP_LIGHT = 1;
const GROUP_SHADE = 2;
const GROUP_HEATING = 3;
const GROUP_AUDIO = 4;
const GROUP_VIDEO = 5;
const GROUP_SECURITY = 6;
const GROUP_ACCESS = 7;
const GROUP_JOKER = 8;
const GROUP_COOLING = 9;
const GROUP_VENTILATION = 10;
const GROUP_WINDOW = 11;
const GROUP_TEMP_CONTROL = 48;

// Scene Numbers
const SCENE_OFF = 0;
const SCENE_1 = 5;
const SCENE_2 = 17;
const SCENE_3 = 18;
const SCENE_4 = 19;
const SCENE_STOP = 15;
const SCENE_PRESENT = 71;
const SCENE_ABSENT = 72;
const SCENE_SLEEPING = 69;
const SCENE_WAKEUP = 70;
const SCENE_STANDBY = 67;
const SCENE_DEEP_OFF = 68;
const SCENE_PANIC = 65;
const SCENE_DOOR_BELL = 73;
const SCENE_ALARM_1 = 74;
const SCENE_ALARM_2 = 75;
const SCENE_ALARM_3 = 76;
const SCENE_ALARM_4 = 77;
const SCENE_FIRE = 76;
const SCENE_RAIN = 85;
const SCENE_COVER_SUN_PROTECT = 11;

// Sensor Types
const SENSOR_TEMPERATURE = 9;
const SENSOR_HUMIDITY = 13;
const SENSOR_BRIGHTNESS = 11;
const SENSOR_CO2 = 21;
const SENSOR_SOUND = 25;
const SENSOR_WIND_SPEED = 14;
const SENSOR_WIND_GUST = 15;
const SENSOR_WIND_DIRECTION = 16;
const SENSOR_RAIN = 17;
const SENSOR_AIR_PRESSURE = 18;

// Presence scene numbers
const PRESENCE_SCENES = [SCENE_PRESENT, SCENE_ABSENT, SCENE_SLEEPING, SCENE_WAKEUP, SCENE_STANDBY, SCENE_DEEP_OFF];

// Alarm scene numbers
const ALARM_SCENES = [SCENE_ALARM_1, SCENE_ALARM_2, SCENE_ALARM_3, SCENE_ALARM_4, SCENE_PANIC, SCENE_DOOR_BELL];

// Polling intervals (ms)
const POLL_INTERVAL = 30000;
const POLL_INTERVAL_TEMPERATURE = 300000;
const EVENT_POLL_TIMEOUT = 60;
const EVENT_SUBSCRIPTION_ID = 42;
const RECONNECT_INITIAL = 5000;
const RECONNECT_MAX = 60000;

// Events to subscribe
const SUBSCRIBED_EVENTS = [
  'callScene', 'undoScene', 'zoneSensorValue',
  'stateChange', 'deviceSensorValue', 'running',
];

class DssApiError extends Error {
  constructor(message, statusCode = null) {
    super(message);
    this.name = 'DssApiError';
    this.statusCode = statusCode;
  }
}

class DssAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DssAuthError';
  }
}

/**
 * Digital Strom Server (dSS) JSON API Client.
 * Port of the Python api.py from ha-digitalstrom-smart.
 */
class DssClient {
  /**
   * @param {string} host - dSS IP or hostname
   * @param {number} port - dSS port (default 8080)
   * @param {object} options
   * @param {string} options.appToken - Application token for login
   * @param {string} options.username - Cloud username (for Digest auth)
   * @param {string} options.password - Cloud password (for Digest auth)
   * @param {object} options.logger - Homey.app.log compatible logger
   */
  constructor(host, port = 8080, options = {}) {
    this.host = host;
    this.port = port;
    this.appToken = options.appToken || null;
    this.username = options.username || null;
    this.password = options.password || null;
    this.log = options.logger || console.log;

    this._sessionToken = null;
    this._isCloud = false;
    this._csrfToken = null;
    this._digestNonce = null;
    this._digestRealm = null;
    this._digestNc = 0;
    this._connected = false;
    this._abortController = null;
  }

  /**
   * Make an HTTP(S) request to the dSS.
   * @param {string} path - API path (e.g. /json/system/version)
   * @param {object} params - Query parameters
   * @param {string} method - HTTP method
   * @returns {Promise<object>} Parsed JSON result
   */
  async request(path, params = {}, method = 'GET') {
    if (this._sessionToken && !params.token) {
      params.token = this._sessionToken;
    }

    const url = new URL(`https://${this.host}:${this.port}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {};
    if (this._isCloud) {
      if (this._csrfToken) {
        headers['X-CSRF-Token'] = this._csrfToken;
        headers['X-Requested-With'] = 'XMLHttpRequest';
      }
      if (this._digestNonce && this._digestRealm && this.username && this.password) {
        headers['Authorization'] = this._buildDigestHeader(
          this.username, this.password, method, url.pathname + url.search,
          this._digestRealm, this._digestNonce,
        );
      }
    }

    const requestOptions = {
      method,
      headers,
      rejectUnauthorized: false, // dSS uses self-signed certs
      signal: this._abortController?.signal,
    };

    return new Promise((resolve, reject) => {
      const protocol = this.port === 443 || this.port === 8080 ? https : http;
      const req = protocol.request(url, requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          // Extract CSRF token from cookies
          const setCookie = res.headers['set-cookie'];
          if (setCookie) {
            for (const cookie of setCookie) {
              const match = cookie.match(/csrf-token=([^;]+)/);
              if (match) this._csrfToken = match[1];
            }
          }

          // Handle 401 for Digest auth
          if (res.statusCode === 401) {
            const wwwAuth = res.headers['www-authenticate'];
            if (wwwAuth && wwwAuth.startsWith('Digest')) {
              this._parseDigestChallenge(wwwAuth);
              // Retry with Digest
              resolve(this.request(path, params, method));
              return;
            }
            reject(new DssAuthError(`Authentication failed: ${res.statusCode}`));
            return;
          }

          if (res.statusCode >= 400) {
            reject(new DssApiError(`HTTP ${res.statusCode}: ${data}`, res.statusCode));
            return;
          }

          try {
            const json = JSON.parse(data);
            if (json.ok === false) {
              const msg = json.message || 'Unknown dSS error';
              if (msg.includes('not logged in') || msg.includes('token')) {
                reject(new DssAuthError(msg));
              } else {
                reject(new DssApiError(msg));
              }
              return;
            }
            resolve(json.result || json);
          } catch (e) {
            reject(new DssApiError(`Invalid JSON response: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        if (err.name === 'AbortError') {
          reject(new DssApiError('Request aborted'));
        } else {
          reject(new DssApiError(`Connection error: ${err.message}`));
        }
      });

      req.setTimeout(30000, () => {
        req.destroy();
        reject(new DssApiError('Request timeout'));
      });

      req.end();
    });
  }

  // --- Digest Auth ---

  _parseDigestChallenge(header) {
    const realmMatch = header.match(/realm="([^"]+)"/);
    const nonceMatch = header.match(/nonce="([^"]+)"/);
    if (realmMatch) this._digestRealm = realmMatch[1];
    if (nonceMatch) this._digestNonce = nonceMatch[1];
    this._digestNc = 0;
  }

  _buildDigestHeader(username, password, method, uri, realm, nonce, qop = '') {
    this._digestNc++;
    const nc = this._digestNc.toString(16).padStart(8, '0');
    const cnonce = crypto.randomBytes(8).toString('hex');

    const ha1 = crypto.createHash('md5').update(`${username}:${realm}:${password}`).digest('hex');
    const ha2 = crypto.createHash('md5').update(`${method}:${uri}`).digest('hex');

    let response;
    if (qop) {
      response = crypto.createHash('md5')
        .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        .digest('hex');
    } else {
      response = crypto.createHash('md5')
        .update(`${ha1}:${nonce}:${ha2}`)
        .digest('hex');
    }

    let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
    if (qop) {
      header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    }
    return header;
  }

  // --- Connection ---

  async connect() {
    this._abortController = new AbortController();
    if (this.appToken) {
      await this._connectLocal();
    } else if (this.username && this.password) {
      await this._connectCloud();
    } else {
      throw new DssAuthError('No credentials provided');
    }
    this._connected = true;
  }

  async _connectLocal() {
    const result = await this.request('/json/system/loginApplication', {
      loginToken: this.appToken,
    });
    this._sessionToken = result.token;
    this.log('Connected to dSS (local) with app token');
  }

  async _connectCloud() {
    this._isCloud = true;
    // First request triggers Digest auth challenge
    await this.request('/json/system/version');
    this.log('Connected to dSS (cloud) with Digest auth');
  }

  async disconnect() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
    this._sessionToken = null;
    this._connected = false;
  }

  get isConnected() {
    return this._connected;
  }

  // --- App Token Registration ---

  async requestAppToken(appName = 'WoonIoT Homey Connect') {
    const result = await this.request('/json/system/requestApplicationToken', {
      applicationName: appName,
    });
    return result.applicationToken;
  }

  async checkAppToken(token) {
    try {
      const result = await this.request('/json/system/loginApplication', {
        loginToken: token,
      });
      return !!result.token;
    } catch {
      return false;
    }
  }

  // --- System ---

  async getVersion() {
    return this.request('/json/system/version');
  }

  async getTime() {
    return this.request('/json/system/time');
  }

  // --- Apartment / Structure ---

  async getStructure() {
    return this.request('/json/apartment/getStructure');
  }

  async getConsumption() {
    const result = await this.request('/json/apartment/getConsumption');
    return result.consumption || 0;
  }

  async getTemperatureValues() {
    return this.request('/json/apartment/getTemperatureValues');
  }

  async getSensorValues() {
    return this.request('/json/apartment/getSensorValues');
  }

  async getZoneSensorValues(zoneId) {
    return this.request('/json/zone/getSensorValues', { id: zoneId });
  }

  async getCircuits() {
    return this.request('/json/apartment/getCircuits');
  }

  async getReachableGroups(zoneId) {
    return this.request('/json/zone/getReachableGroups', { id: zoneId });
  }

  // --- Zone Commands ---

  async callScene(zoneId, group, sceneNr) {
    return this.request('/json/zone/callScene', {
      id: zoneId,
      groupID: group,
      sceneNumber: sceneNr,
    });
  }

  async undoScene(zoneId, group, sceneNr) {
    return this.request('/json/zone/undoScene', {
      id: zoneId,
      groupID: group,
      sceneNumber: sceneNr,
    });
  }

  async turnOn(zoneId, group) {
    return this.callScene(zoneId, group, SCENE_1);
  }

  async turnOff(zoneId, group) {
    return this.callScene(zoneId, group, SCENE_OFF);
  }

  async setValue(zoneId, group, value) {
    return this.request('/json/zone/setValue', {
      id: zoneId,
      groupID: group,
      value,
    });
  }

  async increaseValue(zoneId, group) {
    return this.request('/json/zone/increaseValue', {
      id: zoneId,
      groupID: group,
    });
  }

  async decreaseValue(zoneId, group) {
    return this.request('/json/zone/decreaseValue', {
      id: zoneId,
      groupID: group,
    });
  }

  // --- Scene Discovery ---

  async getReachableScenes(zoneId, group) {
    return this.request('/json/zone/getReachableScenes', {
      id: zoneId,
      groupID: group,
    });
  }

  async getLastCalledScene(zoneId, group) {
    return this.request('/json/zone/getLastCalledScene', {
      id: zoneId,
      groupID: group,
    });
  }

  async getSceneName(zoneId, group, sceneNr) {
    return this.request('/json/zone/sceneGetName', {
      id: zoneId,
      groupID: group,
      sceneNumber: sceneNr,
    });
  }

  async saveScene(zoneId, group, sceneNr) {
    return this.request('/json/zone/saveScene', {
      id: zoneId,
      groupID: group,
      sceneNumber: sceneNr,
    });
  }

  // --- Climate Control ---

  async getTemperatureControlStatus(zoneId) {
    return this.request('/json/zone/getTemperatureControlStatus', { id: zoneId });
  }

  async getTemperatureControlConfig(zoneId) {
    return this.request('/json/zone/getTemperatureControlConfig2', { id: zoneId });
  }

  async setTemperatureControlValues(zoneId, nominalValue) {
    return this.request('/json/zone/setTemperatureControlValues', {
      id: zoneId,
      NominalValue: nominalValue,
    });
  }

  // --- Device Commands ---

  async getDeviceState(dsuid) {
    return this.request('/json/device/getState', { dsuid });
  }

  async getDeviceOutputValue(dsuid, offset = 0) {
    return this.request('/json/device/getOutputValue', { dsuid, offset });
  }

  async getDeviceSensorValue(dsuid, sensorIndex = 0) {
    return this.request('/json/device/getSensorValue', { dsuid, sensorIndex });
  }

  async deviceTurnOn(dsuid) {
    return this.request('/json/device/turnOn', { dsuid });
  }

  async deviceTurnOff(dsuid) {
    return this.request('/json/device/turnOff', { dsuid });
  }

  async blinkDevice(dsuid) {
    return this.request('/json/device/blink', { dsuid });
  }

  // --- Metering ---

  async getMeteringLatest(meterDsuid, meterType = 'consumption') {
    return this.request('/json/metering/getLatest', {
      dsuid: meterDsuid,
      type: meterType,
    });
  }

  async getMeteringValues(meterDsuid, resolution = 300, valueCount = 1) {
    return this.request('/json/metering/getValues', {
      dsuid: meterDsuid,
      type: 'consumption',
      resolution,
      valueCount,
    });
  }

  async getCircuitEnergy(dsuid) {
    return this.request('/json/circuit/getEnergyBorder', { dsuid });
  }

  // --- Event Subscription ---

  async subscribeEvents(subscriptionId = EVENT_SUBSCRIPTION_ID) {
    for (const eventName of SUBSCRIBED_EVENTS) {
      await this.request('/json/event/subscribe', {
        subscriptionID: subscriptionId,
        name: eventName,
      });
    }
    return subscriptionId;
  }

  async getEvents(subscriptionId = EVENT_SUBSCRIPTION_ID, timeout = EVENT_POLL_TIMEOUT) {
    return this.request('/json/event/get', {
      subscriptionID: subscriptionId,
      timeout,
    });
  }
}

module.exports = {
  DssClient,
  DssApiError,
  DssAuthError,
  // Constants
  GROUP_LIGHT,
  GROUP_SHADE,
  GROUP_HEATING,
  GROUP_AUDIO,
  GROUP_VIDEO,
  GROUP_SECURITY,
  GROUP_ACCESS,
  GROUP_JOKER,
  GROUP_COOLING,
  GROUP_VENTILATION,
  GROUP_WINDOW,
  GROUP_TEMP_CONTROL,
  SCENE_OFF,
  SCENE_1,
  SCENE_2,
  SCENE_3,
  SCENE_4,
  SCENE_STOP,
  SCENE_PRESENT,
  SCENE_ABSENT,
  SCENE_SLEEPING,
  SCENE_WAKEUP,
  SCENE_STANDBY,
  SCENE_DEEP_OFF,
  SCENE_PANIC,
  SCENE_DOOR_BELL,
  SCENE_ALARM_1,
  SCENE_ALARM_2,
  SCENE_ALARM_3,
  SCENE_ALARM_4,
  SCENE_FIRE,
  SCENE_RAIN,
  SCENE_COVER_SUN_PROTECT,
  SENSOR_TEMPERATURE,
  SENSOR_HUMIDITY,
  SENSOR_BRIGHTNESS,
  SENSOR_CO2,
  SENSOR_SOUND,
  SENSOR_WIND_SPEED,
  SENSOR_WIND_GUST,
  SENSOR_WIND_DIRECTION,
  SENSOR_RAIN,
  SENSOR_AIR_PRESSURE,
  PRESENCE_SCENES,
  ALARM_SCENES,
  POLL_INTERVAL,
  POLL_INTERVAL_TEMPERATURE,
  EVENT_SUBSCRIPTION_ID,
  RECONNECT_INITIAL,
  RECONNECT_MAX,
  SUBSCRIBED_EVENTS,
};
