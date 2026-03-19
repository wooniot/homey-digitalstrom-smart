'use strict';

const Homey = require('homey');
const { DssClient } = require('./lib/dss-client');
const { DssCoordinator } = require('./lib/coordinator');
const { LicenseManager } = require('./lib/license');

class DigitalStromApp extends Homey.App {
  async onInit() {
    this.log('Digital Strom Smart is starting...');

    this._clients = {};      // {sessionId} → DssClient
    this._coordinators = {};  // {sessionId} → DssCoordinator
    this._license = new LicenseManager({ logger: this.log.bind(this) });

    // Register Flow action cards
    this._registerFlowCards();

    // Expose API for settings page
    this.log('Digital Strom Smart has been initialized');
  }

  // --- Session Management ---

  /**
   * Create or get a dSS client+coordinator for a pairing session / device store.
   * Called by drivers during pairing and device init.
   */
  async getSession(sessionId, { host, port, appToken, dssId } = {}) {
    if (this._coordinators[sessionId]) {
      return {
        client: this._clients[sessionId],
        coordinator: this._coordinators[sessionId],
        license: this._license,
      };
    }

    if (!host || !appToken) {
      throw new Error('Host and appToken required for new session');
    }

    const client = new DssClient(host, port || 8080, {
      appToken,
      logger: this.log.bind(this),
    });

    await client.connect();

    const structure = await client.getStructure();
    const coordinator = new DssCoordinator(client, structure, {
      dssId: dssId || '',
      logger: this.log.bind(this),
    });

    // Validate license
    const licenseKey = this.homey.settings.get('pro_license_key') || '';
    if (licenseKey) {
      const result = await this._license.validate(licenseKey, (dssId || '').substring(0, 8), 'homey');
      coordinator.proEnabled = result.valid;
      this.log(`License validation: ${result.valid ? 'Pro enabled' : 'Free tier'} (${result.type || 'none'})`);
    }

    // Fetch initial data
    await coordinator.fetchSceneNames();
    await coordinator.fetchInitialStates();

    if (coordinator.proEnabled) {
      await coordinator.fetchClimateData();
      await coordinator.fetchApartmentState();
      await coordinator.fetchSensorData();
    }

    // Start event listener & polling
    await coordinator.startEventListener();
    coordinator.startPolling();

    this._clients[sessionId] = client;
    this._coordinators[sessionId] = coordinator;

    return { client, coordinator, license: this._license };
  }

  async removeSession(sessionId) {
    if (this._coordinators[sessionId]) {
      await this._coordinators[sessionId].destroy();
      delete this._coordinators[sessionId];
    }
    if (this._clients[sessionId]) {
      await this._clients[sessionId].disconnect();
      delete this._clients[sessionId];
    }
  }

  // --- Flow Cards ---

  _registerFlowCards() {
    // Call Scene (Free)
    const callSceneAction = this.homey.flow.getActionCard('call_scene');
    callSceneAction.registerRunListener(async (args) => {
      const sessionId = this._getFirstSessionId();
      if (!sessionId) throw new Error('No dSS connected');
      const client = this._clients[sessionId];
      await client.callScene(args.zone, args.group, args.scene);
    });

    // Blink Device (Pro)
    const blinkAction = this.homey.flow.getActionCard('blink_device');
    blinkAction.registerRunListener(async (args) => {
      if (!this._license.proEnabled) {
        throw new Error('Pro license required for blink');
      }
      const sessionId = this._getFirstSessionId();
      if (!sessionId) throw new Error('No dSS connected');
      const client = this._clients[sessionId];
      await client.blinkDevice(args.dsuid);
    });

    // Save Scene (Pro)
    const saveSceneAction = this.homey.flow.getActionCard('save_scene');
    saveSceneAction.registerRunListener(async (args) => {
      if (!this._license.proEnabled) {
        throw new Error('Pro license required for save scene');
      }
      const sessionId = this._getFirstSessionId();
      if (!sessionId) throw new Error('No dSS connected');
      const client = this._clients[sessionId];
      await client.saveScene(args.zone, args.group, args.scene);
    });
  }

  _getFirstSessionId() {
    const ids = Object.keys(this._coordinators);
    return ids.length > 0 ? ids[0] : null;
  }

  // --- Settings API ---

  async onApiSetLicense({ body }) {
    const { key } = body;
    this.homey.settings.set('pro_license_key', key || '');

    // Re-validate for all sessions
    for (const [sessionId, coordinator] of Object.entries(this._coordinators)) {
      const dssId = coordinator.dssId || '';
      const result = await this._license.validate(key || '', dssId.substring(0, 8), 'homey');
      coordinator.proEnabled = result.valid;

      if (result.valid) {
        await coordinator.fetchClimateData();
        await coordinator.fetchApartmentState();
        await coordinator.fetchSensorData();
      }
    }

    return { valid: this._license.proEnabled, type: this._license.licenseType };
  }

  async onApiGetLicense() {
    return {
      key: this.homey.settings.get('pro_license_key') || '',
      valid: this._license.proEnabled,
      type: this._license.licenseType,
    };
  }

  // --- Cleanup ---

  async onUninit() {
    for (const sessionId of Object.keys(this._coordinators)) {
      await this.removeSession(sessionId);
    }
  }
}

module.exports = DigitalStromApp;
