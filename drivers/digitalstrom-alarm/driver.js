'use strict';

const Homey = require('homey');
const { SCENE_ALARM_1, SCENE_ALARM_2, SCENE_ALARM_3, SCENE_ALARM_4, SCENE_PANIC, SCENE_DOOR_BELL } = require('../../lib/dss-client');

const ALARM_TYPES = [
  { scene: SCENE_ALARM_1, name: 'Alarm 1' },
  { scene: SCENE_ALARM_2, name: 'Alarm 2' },
  { scene: SCENE_ALARM_3, name: 'Alarm 3' },
  { scene: SCENE_ALARM_4, name: 'Alarm 4' },
  { scene: SCENE_PANIC, name: 'Panic' },
  { scene: SCENE_DOOR_BELL, name: 'Doorbell' },
];

class DigitalStromAlarmDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Alarm driver initialized (Pro)');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      if (!coordinator.proEnabled) continue;

      for (const alarm of ALARM_TYPES) {
        devices.push({
          name: `Digital Strom ${alarm.name}`,
          data: {
            id: `${sessionId}-alarm-${alarm.scene}`,
            sessionId,
            sceneNr: alarm.scene,
          },
          store: {
            host: app._clients[sessionId]?.host,
            port: app._clients[sessionId]?.port,
            appToken: app._clients[sessionId]?.appToken,
            dssId: coordinator.dssId,
          },
        });
      }
    }

    return devices;
  }
}

module.exports = DigitalStromAlarmDriver;
