'use strict';

const Homey = require('homey');
const { GROUP_JOKER } = require('../../lib/dss-client');

class DigitalStromSwitchDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Switch driver initialized');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      for (const [zoneId] of Object.entries(coordinator.zones)) {
        const actuators = coordinator.getJokerActuators(parseInt(zoneId));

        for (const device of actuators) {
          devices.push({
            name: device.name || `Switch ${device.dsuid.substring(0, 8)}`,
            data: {
              id: `${sessionId}-switch-${device.dsuid}`,
              sessionId,
              dsuid: device.dsuid,
              zoneId: parseInt(zoneId),
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
    }

    return devices;
  }
}

module.exports = DigitalStromSwitchDriver;
