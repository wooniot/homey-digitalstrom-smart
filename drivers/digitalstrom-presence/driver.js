'use strict';

const Homey = require('homey');

class DigitalStromPresenceDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Presence driver initialized (Pro)');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      if (!coordinator.proEnabled) continue;

      devices.push({
        name: 'Digital Strom Presence',
        data: {
          id: `${sessionId}-presence`,
          sessionId,
        },
        store: {
          host: app._clients[sessionId]?.host,
          port: app._clients[sessionId]?.port,
          appToken: app._clients[sessionId]?.appToken,
          dssId: coordinator.dssId,
        },
      });
    }

    return devices;
  }
}

module.exports = DigitalStromPresenceDriver;
