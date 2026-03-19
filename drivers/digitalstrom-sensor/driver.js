'use strict';

const Homey = require('homey');
const { GROUP_JOKER } = require('../../lib/dss-client');

class DigitalStromSensorDriver extends Homey.Driver {
  async onInit() {
    this.log('Digital Strom Sensor driver initialized');
  }

  async onPairListDevices() {
    const app = this.homey.app;
    const devices = [];

    for (const [sessionId, coordinator] of Object.entries(app._coordinators)) {
      for (const [zoneId] of Object.entries(coordinator.zones)) {
        const sensors = coordinator.getJokerSensors(parseInt(zoneId));

        for (const device of sensors) {
          // Map inputType to device class
          const inputType = device.binaryInputs[0]?.inputType || 0;
          const classMap = {
            1: 'motion',     // presence
            7: 'smoke',      // smoke detector
            13: 'contact',   // window contact
            14: 'door',      // door contact
          };

          devices.push({
            name: device.name || `Sensor ${device.dsuid.substring(0, 8)}`,
            data: {
              id: `${sessionId}-sensor-${device.dsuid}`,
              sessionId,
              dsuid: device.dsuid,
              zoneId: parseInt(zoneId),
              inputType,
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

module.exports = DigitalStromSensorDriver;
