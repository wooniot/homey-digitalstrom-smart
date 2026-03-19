'use strict';

const Homey = require('homey');

class DigitalStromWeatherDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Weather driver initialized (Pro)');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      if (!coordinator.proEnabled) continue;

      const outdoor = coordinator.getOutdoorSensors();
      if (Object.keys(outdoor).length === 0) continue;

      devices.push({
        name: 'Digital Strom Outdoor Weather',
        data: {
          id: `${sessionId}-weather`,
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

module.exports = DigitalStromWeatherDriver;
