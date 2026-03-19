'use strict';

const Homey = require('homey');

class DigitalStromSensorDevice extends Homey.Device {
  async onInit() {
    const { sessionId, dsuid, zoneId } = this.getData();
    this._sessionId = sessionId;
    this._dsuid = dsuid;
    this._zoneId = zoneId;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;

    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log(`Sensor device initialized: ${dsuid}`);
  }

  _onStateChanged() {
    this._updateState();
  }

  _updateState() {
    const isOn = this._coordinator.getDeviceOnState(this._dsuid);
    this.setCapabilityValue('alarm_generic', isOn).catch(this.error);
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromSensorDevice;
