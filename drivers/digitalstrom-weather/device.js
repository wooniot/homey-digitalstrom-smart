'use strict';

const Homey = require('homey');
const { SENSOR_TEMPERATURE, SENSOR_HUMIDITY, SENSOR_WIND_SPEED } = require('../../lib/dss-client');

class DigitalStromWeatherDevice extends Homey.Device {
  async onInit() {
    const { sessionId } = this.getData();
    this._sessionId = sessionId;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;

    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log('Weather device initialized');
  }

  _onStateChanged({ event }) {
    if (event === 'poll') {
      this._updateState();
    }
  }

  _updateState() {
    const outdoor = this._coordinator.getOutdoorSensors();

    if (outdoor[SENSOR_TEMPERATURE]) {
      this.setCapabilityValue('measure_temperature', outdoor[SENSOR_TEMPERATURE].value).catch(this.error);
    }
    if (outdoor[SENSOR_HUMIDITY]) {
      this.setCapabilityValue('measure_humidity', outdoor[SENSOR_HUMIDITY].value).catch(this.error);
    }
    if (outdoor[SENSOR_WIND_SPEED]) {
      this.setCapabilityValue('measure_wind_strength', outdoor[SENSOR_WIND_SPEED].value).catch(this.error);
    }
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromWeatherDevice;
