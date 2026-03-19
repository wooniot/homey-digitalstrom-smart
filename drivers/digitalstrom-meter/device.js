'use strict';

const Homey = require('homey');

class DigitalStromMeterDevice extends Homey.Device {
  async onInit() {
    const { sessionId, type, zoneId } = this.getData();
    this._sessionId = sessionId;
    this._type = type;
    this._zoneId = zoneId;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;

    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log(`Meter device initialized: ${type} ${zoneId || 'total'}`);
  }

  _onStateChanged({ event }) {
    if (event === 'poll' || event === 'zoneSensorValue') {
      this._updateState();
    }
  }

  _updateState() {
    switch (this._type) {
      case 'total': {
        const consumption = this._coordinator.getConsumption();
        this.setCapabilityValue('measure_power', consumption).catch(this.error);
        break;
      }
      case 'zone_temperature': {
        const temp = this._coordinator.getCurrentTemperature(this._zoneId);
        if (temp !== null) {
          this.setCapabilityValue('measure_temperature', temp).catch(this.error);
        }
        break;
      }
    }
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromMeterDevice;
