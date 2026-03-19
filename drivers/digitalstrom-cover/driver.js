'use strict';

const Homey = require('homey');
const { GROUP_SHADE } = require('../../lib/dss-client');

class DigitalStromCoverDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Cover driver initialized');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      for (const [zoneId, zone] of Object.entries(coordinator.zones)) {
        if (!zone.groups.has(GROUP_SHADE)) continue;

        devices.push({
          name: `${zone.name} Cover`,
          data: {
            id: `${sessionId}-cover-${zoneId}`,
            sessionId,
            zoneId: parseInt(zoneId),
            group: GROUP_SHADE,
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

module.exports = DigitalStromCoverDriver;
