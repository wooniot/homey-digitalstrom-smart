'use strict';

const Homey = require('homey');
const { GROUP_LIGHT, SCENE_OFF, SCENE_1 } = require('../../lib/dss-client');

class DigitalStromLightDevice extends Homey.Device {
  async onInit() {
    const { sessionId, zoneId, group } = this.getData();
    this._sessionId = sessionId;
    this._zoneId = zoneId;
    this._group = group || GROUP_LIGHT;

    // Get coordinator from app
    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;
    this._client = session.client;

    // Register capability listeners
    this.registerCapabilityListener('onoff', this._onOnOff.bind(this));
    this.registerCapabilityListener('dim', this._onDim.bind(this));

    // Listen for state changes
    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));

    // Set initial state
    this._updateState();
    this.log(`Light device initialized: zone ${zoneId}`);
  }

  async _onOnOff(value) {
    if (value) {
      await this._client.turnOn(this._zoneId, this._group);
    } else {
      await this._client.turnOff(this._zoneId, this._group);
    }
  }

  async _onDim(value) {
    // Homey dim: 0-1 float → dS value: 0-255
    const dsValue = Math.round(value * 255);
    if (dsValue === 0) {
      await this._client.turnOff(this._zoneId, this._group);
    } else {
      await this._client.setValue(this._zoneId, this._group, dsValue);
    }
  }

  _onStateChanged({ event }) {
    if (event === 'callScene' || event === 'undoScene' || event === 'poll') {
      this._updateState();
    }
  }

  _updateState() {
    const state = this._coordinator.getZoneState(this._zoneId, this._group);

    this.setCapabilityValue('onoff', state.isOn).catch(this.error);

    // Estimate dim from scene
    if (state.scene === SCENE_OFF) {
      this.setCapabilityValue('dim', 0).catch(this.error);
    } else if (state.scene === SCENE_1) {
      this.setCapabilityValue('dim', 1).catch(this.error);
    }
    // For intermediate values, we'd need getOutputValue per device
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromLightDevice;
