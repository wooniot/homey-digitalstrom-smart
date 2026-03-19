'use strict';

const Homey = require('homey');
const {
  SCENE_PRESENT, SCENE_ABSENT, SCENE_SLEEPING,
  SCENE_WAKEUP, SCENE_STANDBY, SCENE_DEEP_OFF,
} = require('../../lib/dss-client');

const SCENE_TO_MODE = {
  [SCENE_PRESENT]: 'present',
  [SCENE_ABSENT]: 'absent',
  [SCENE_SLEEPING]: 'sleeping',
  [SCENE_WAKEUP]: 'wakeup',
  [SCENE_STANDBY]: 'standby',
  [SCENE_DEEP_OFF]: 'deep_off',
};

const MODE_TO_SCENE = {
  present: SCENE_PRESENT,
  absent: SCENE_ABSENT,
  sleeping: SCENE_SLEEPING,
  wakeup: SCENE_WAKEUP,
  standby: SCENE_STANDBY,
  deep_off: SCENE_DEEP_OFF,
};

class DigitalStromPresenceDevice extends Homey.Device {
  async onInit() {
    const { sessionId } = this.getData();
    this._sessionId = sessionId;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;

    this.registerCapabilityListener('ds_presence_mode', this._onSetMode.bind(this));
    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log('Presence device initialized');
  }

  async _onSetMode(value) {
    const scene = MODE_TO_SCENE[value];
    if (scene !== undefined) {
      await this._coordinator.callApartmentScene(scene);
    }
  }

  _onStateChanged() {
    this._updateState();
  }

  _updateState() {
    const presence = this._coordinator.getApartmentPresence();
    const mode = SCENE_TO_MODE[presence];
    if (mode) {
      this.setCapabilityValue('ds_presence_mode', mode).catch(this.error);
    }
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromPresenceDevice;
