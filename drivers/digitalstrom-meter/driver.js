'use strict';

const Homey = require('homey');

class DigitalStromMeterDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Meter driver initialized');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      // Apartment total consumption
      devices.push({
        name: 'Digital Strom Total Power',
        data: {
          id: `${sessionId}-meter-total`,
          sessionId,
          type: 'total',
        },
        store: {
          host: app._clients[sessionId]?.host,
          port: app._clients[sessionId]?.port,
          appToken: app._clients[sessionId]?.appToken,
          dssId: coordinator.dssId,
        },
      });

      // Zone temperature sensors
      for (const [zoneId, zone] of Object.entries(coordinator.zones)) {
        const temp = coordinator.getCurrentTemperature(parseInt(zoneId));
        if (temp !== null) {
          devices.push({
            name: `${zone.name} Temperature`,
            data: {
              id: `${sessionId}-meter-temp-${zoneId}`,
              sessionId,
              type: 'zone_temperature',
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

module.exports = DigitalStromMeterDriver;
