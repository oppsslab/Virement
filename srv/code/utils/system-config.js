"use strict";

const cds = require("@sap/cds");

const LOG = cds.log("system-config");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

// Short TTL, not "load once at boot" - the whole point of this table
// is that an admin can change a value without a redeploy, so a
// request shortly after an edit should see it without needing the
// app to restart.
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null; // { values: Map<key, value>, expiresAt }

async function loadAll() {
  const { SystemConfiguration } = cds.entities(SERVICE_NAMESPACE);

  const rows = await SELECT.from(SystemConfiguration).columns(
    "configKey",
    "configValue",
  );

  const values = new Map();

  for (const row of rows || []) {
    values.set(row.configKey, row.configValue);
  }

  return values;
}

/**
 * Reads one System Configuration value by key, falling back to the
 * given default if the row is missing, empty, or the lookup itself
 * fails (never throws - a missing config row should not break the
 * feature that reads it, it should just behave like before this
 * table existed).
 *
 * @param {string} key - e.g. "WORKFLOW_DEFINITION_ID"
 * @param {string} fallbackDefault
 * @returns {Promise<string>}
 */
async function getConfigValue(key, fallbackDefault) {
  try {
    const now = Date.now();

    if (!cache || cache.expiresAt <= now) {
      cache = {
        values: await loadAll(),
        expiresAt: now + CACHE_TTL_MS,
      };
    }

    const value = cache.values.get(key);

    return value || fallbackDefault;
  } catch (error) {
    LOG.warn(
      `Could not read System Configuration key "${key}" - using the default.`,
      JSON.stringify({ message: error.message }),
    );

    return fallbackDefault;
  }
}

/**
 * Drops the cached values so the next getConfigValue reads the
 * database again, instead of waiting out the TTL. Called after a
 * SystemConfiguration row is saved, so an admin's edit (and a
 * Test Connection run right after it) sees it immediately.
 *
 * @returns {void}
 */
function invalidateCache() {
  cache = null;
}

module.exports = { getConfigValue, invalidateCache };
