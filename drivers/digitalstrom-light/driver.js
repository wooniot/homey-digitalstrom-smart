'use strict';

const Homey = require('homey');
const { GROUP_LIGHT } = require('../../lib/dss-client');

class DigitalStromLightDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Light driver initialized');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      for (const [zoneId, zone] of Object.entries(coordinator.zones)) {
        if (!zone.groups.has(GROUP_LIGHT)) continue;

        devices.push({
          name: `${zone.name} Light`,
          data: {
            id: `${sessionId}-light-${zoneId}`,
            sessionId,
            zoneId: parseInt(zoneId),
            group: GROUP_LIGHT,
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

module.exports = DigitalStromLightDriver;
