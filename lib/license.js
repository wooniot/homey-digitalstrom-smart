'use strict';

const crypto = require('crypto');
const https = require('https');

const LICENSE_URL = 'https://ha-ds.internetist.nl/ha-ds/license';
const HMAC_SECRET = 'wooniot-ds-pro-2026-secret-key';

/**
 * License validation for Digital Strom Smart.
 * Supports both online (License API) and offline (HMAC) validation.
 * Port of license.py from ha-digitalstrom-smart.
 */
class LicenseManager {
  /**
   * @param {object} options
   * @param {Function} options.logger - Log function
   */
  constructor(options = {}) {
    this.log = options.logger || console.log;
    this._proEnabled = false;
    this._licenseType = null;
    this._expiresAt = null;
  }

  get proEnabled() {
    return this._proEnabled;
  }

  get licenseType() {
    return this._licenseType;
  }

  /**
   * Validate a license key. Tries online first, falls back to offline HMAC.
   * @param {string} key - License key (TRIAL-XXXX-... or PRO-XXXX-...)
   * @param {string} dssId - First 8 chars of dSS ID
   * @param {string} platform - Platform identifier (default: "homey")
   * @returns {Promise<{valid: boolean, type: string|null, expires: string|null}>}
   */
  async validate(key, dssId = '', platform = 'homey') {
    if (!key || key.trim().length === 0) {
      this._proEnabled = false;
      return { valid: false, type: null, expires: null };
    }

    key = key.trim().toUpperCase();

    // Try online validation first
    try {
      const result = await this._checkOnline(key, dssId, platform);
      this._proEnabled = result.valid;
      this._licenseType = result.type;
      this._expiresAt = result.expires;
      return result;
    } catch (err) {
      this.log(`Online license check failed: ${err.message}, trying offline...`);
    }

    // Offline fallback: HMAC validation
    const offlineResult = this._verifyOffline(key);
    this._proEnabled = offlineResult.valid;
    this._licenseType = offlineResult.valid ? 'offline' : null;
    return offlineResult;
  }

  /**
   * Online validation via License API.
   */
  async _checkOnline(key, dssId, platform) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ key, dss_id: dssId, platform });

      const url = new URL(LICENSE_URL);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        rejectUnauthorized: true,
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({
              valid: json.valid === true,
              type: json.type || null,
              expires: json.expires || null,
              reason: json.reason || null,
            });
          } catch {
            reject(new Error('Invalid license API response'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('License API timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Offline HMAC-SHA256 verification.
   * Key format: PREFIX-HASH1-HASH2-SIGNATURE (or PREFIX-XXXX-XXXX-XXXX-XXXX)
   */
  _verifyOffline(key) {
    const parts = key.split('-');

    // Must start with PRO or TRIAL
    if (parts.length < 4) {
      return { valid: false, type: null, expires: null };
    }

    const prefix = parts[0];
    if (prefix !== 'PRO' && prefix !== 'TRIAL') {
      return { valid: false, type: null, expires: null };
    }

    // Key must be at least 20 chars
    if (key.length < 20) {
      return { valid: false, type: null, expires: null };
    }

    // For longer keys (5 parts: PREFIX-X-X-X-X), verify HMAC on first 4 parts
    if (parts.length >= 5) {
      const body = parts.slice(0, parts.length - 1).join('-');
      const expectedSig = parts[parts.length - 1];

      const hmac = crypto.createHmac('sha256', HMAC_SECRET);
      hmac.update(body);
      const sig = hmac.digest('hex').substring(0, expectedSig.length).toUpperCase();

      if (sig === expectedSig) {
        return { valid: true, type: prefix.toLowerCase(), expires: null };
      }
    }

    // Simple format (3 parts): PREFIX-HASH1-HASH2-SIG
    if (parts.length === 4) {
      const body = `${parts[0]}-${parts[1]}-${parts[2]}`;
      const expectedSig = parts[3];

      const hmac = crypto.createHmac('sha256', HMAC_SECRET);
      hmac.update(body);
      const sig = hmac.digest('hex').substring(0, 4).toUpperCase();

      if (sig === expectedSig) {
        return { valid: true, type: prefix.toLowerCase(), expires: null };
      }
    }

    return { valid: false, type: null, expires: null };
  }
}

module.exports = { LicenseManager };
