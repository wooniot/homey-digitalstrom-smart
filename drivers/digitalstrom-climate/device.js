'use strict';

const Homey = require('homey');
const { SCENE_OFF, SCENE_1, SCENE_2, SCENE_3, SCENE_4 } = require('../../lib/dss-client');

class DigitalStromClimateDevice extends Homey.Device {
  async onInit() {
    const { sessionId, zoneId } = this.getData();
    this._sessionId = sessionId;
    this._zoneId = zoneId;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;
    this._client = session.client;

    this.registerCapabilityListener('target_temperature', this._onSetTarget.bind(this));
    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log(`Climate device initialized: zone ${zoneId}`);
  }

  async _onSetTarget(value) {
    await this._client.setTemperatureControlValues(this._zoneId, value);
  }

  _onStateChanged({ event }) {
    if (event === 'poll' || event === 'zoneSensorValue') {
      this._updateState();
    }
  }

  _updateState() {
    const currentTemp = this._coordinator.getCurrentTemperature(this._zoneId);
    const targetTemp = this._coordinator.getTemperature(this._zoneId);

    if (currentTemp !== null) {
      this.setCapabilityValue('measure_temperature', currentTemp).catch(this.error);
    }
    if (targetTemp !== null) {
      this.setCapabilityValue('target_temperature', targetTemp).catch(this.error);
    }
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromClimateDevice;
