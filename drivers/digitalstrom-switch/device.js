'use strict';

const Homey = require('homey');

class DigitalStromSwitchDevice extends Homey.Device {
  async onInit() {
    const { sessionId, dsuid, zoneId } = this.getData();
    this._sessionId = sessionId;
    this._dsuid = dsuid;
    this._zoneId = zoneId;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;
    this._client = session.client;

    this.registerCapabilityListener('onoff', this._onOnOff.bind(this));
    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log(`Switch device initialized: ${dsuid}`);
  }

  async _onOnOff(value) {
    if (value) {
      await this._client.deviceTurnOn(this._dsuid);
    } else {
      await this._client.deviceTurnOff(this._dsuid);
    }
  }

  _onStateChanged() {
    this._updateState();
  }

  _updateState() {
    const isOn = this._coordinator.getDeviceOnState(this._dsuid);
    this.setCapabilityValue('onoff', isOn).catch(this.error);
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromSwitchDevice;
