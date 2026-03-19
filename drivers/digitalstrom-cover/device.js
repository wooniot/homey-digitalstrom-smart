'use strict';

const Homey = require('homey');
const { GROUP_SHADE, SCENE_OFF, SCENE_1, SCENE_STOP } = require('../../lib/dss-client');

class DigitalStromCoverDevice extends Homey.Device {
  async onInit() {
    const { sessionId, zoneId, group } = this.getData();
    this._sessionId = sessionId;
    this._zoneId = zoneId;
    this._group = group || GROUP_SHADE;

    const session = await this.homey.app.getSession(sessionId, this.getStore());
    this._coordinator = session.coordinator;
    this._client = session.client;

    this.registerCapabilityListener('windowcoverings_set', this._onSet.bind(this));
    this.registerCapabilityListener('windowcoverings_state', this._onState.bind(this));

    this._coordinator.on('stateChanged', this._onStateChanged.bind(this));
    this._updateState();
    this.log(`Cover device initialized: zone ${zoneId}`);
  }

  async _onSet(value) {
    // Homey: 0 = closed, 1 = open → dS: 0 = closed, 255 = open
    const dsValue = Math.round(value * 255);
    await this._client.setValue(this._zoneId, this._group, dsValue);
  }

  async _onState(value) {
    switch (value) {
      case 'up':
        await this._client.callScene(this._zoneId, this._group, SCENE_1); // Open
        break;
      case 'down':
        await this._client.callScene(this._zoneId, this._group, SCENE_OFF); // Close
        break;
      case 'idle':
        await this._client.callScene(this._zoneId, this._group, SCENE_STOP);
        break;
    }
  }

  _onStateChanged({ event }) {
    if (event === 'callScene' || event === 'undoScene' || event === 'poll') {
      this._updateState();
    }
  }

  _updateState() {
    const state = this._coordinator.getZoneState(this._zoneId, this._group);

    if (state.scene === SCENE_OFF) {
      this.setCapabilityValue('windowcoverings_set', 0).catch(this.error);
      this.setCapabilityValue('windowcoverings_state', 'idle').catch(this.error);
    } else if (state.scene === SCENE_1) {
      this.setCapabilityValue('windowcoverings_set', 1).catch(this.error);
      this.setCapabilityValue('windowcoverings_state', 'idle').catch(this.error);
    } else if (state.scene === SCENE_STOP) {
      this.setCapabilityValue('windowcoverings_state', 'idle').catch(this.error);
    }
  }

  async onDeleted() {
    if (this._coordinator) {
      this._coordinator.removeListener('stateChanged', this._onStateChanged.bind(this));
    }
  }
}

module.exports = DigitalStromCoverDevice;
