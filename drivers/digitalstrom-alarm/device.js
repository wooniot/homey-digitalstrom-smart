'use strict';

const Homey = require('homey');
const { SCENE_DOOR_BELL } = require('../../lib/dss-client');

class DigitalStromAlarmDevice extends Homey.Device {
  async onInit() {
    const { sessionId, sceneNr } = this.getData();
    this._sessionId = sessionId;
    this._sceneNr = sceneNr;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;

    this.registerCapabilityListener('onoff', this._onToggle.bind(this));
    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log(`Alarm device initialized: scene ${sceneNr}`);
  }

  async _onToggle(value) {
    if (value) {
      await this._coordinator.callApartmentScene(this._sceneNr);
      // Doorbell: auto-reset after 3 seconds
      if (this._sceneNr === SCENE_DOOR_BELL) {
        this.homey.setTimeout(async () => {
          await this._coordinator.undoApartmentScene(this._sceneNr);
          this.setCapabilityValue('onoff', false).catch(this.error);
        }, 3000);
      }
    } else {
      await this._coordinator.undoApartmentScene(this._sceneNr);
    }
  }

  _onStateChanged() {
    this._updateState();
  }

  _updateState() {
    const alarms = this._coordinator.getApartmentAlarms();
    const active = alarms.has(this._sceneNr);
    this.setCapabilityValue('onoff', active).catch(this.error);

    // Map to homealarm_state
    const state = active ? 'armed' : 'disarmed';
    this.setCapabilityValue('homealarm_state', state).catch(this.error);
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromAlarmDevice;
