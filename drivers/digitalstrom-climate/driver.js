'use strict';

const Homey = require('homey');

class DigitalStromClimateDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Climate driver initialized (Pro)');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      if (!coordinator.proEnabled) {
        this.log('Climate driver: Pro license not active, no devices');
        continue;
      }

      for (const [zoneId, zone] of Object.entries(coordinator.zones)) {
        if (!coordinator.hasTemperatureControl(parseInt(zoneId))) continue;

        devices.push({
          name: `${zone.name} Climate`,
          data: {
            id: `${sessionId}-climate-${zoneId}`,
            sessionId,
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

    return devices;
  }
}

module.exports = DigitalStromClimateDriver;
