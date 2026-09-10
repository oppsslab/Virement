"use strict";

const cds = require("@sap/cds");

const { readGLAccounts } = require("./gl-accounts");

const LOG = cds.log("gl-account-name-lookup");

/**
 * Looks up the GL Account Name for a GL Account from S/4 (the same
 * live lookup the GL Account value help itself uses), for the
 * read-only GL Account Name display field on RequestItems (Virement
 * item tables).
 *
 * Best-effort: an S/4 read failure (timeout, destination issue) is
 * logged and resolves to null rather than blocking the item
 * create/update - a description is a display convenience, not
 * required data.
 *
 * @param {string} glAccount
 * @returns {Promise<string|null>}
 */
async function resolveGLAccountName(glAccount) {
  const trimmed = String(glAccount || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    const rows = await readGLAccounts(trimmed);

    const match = rows.find(
      (row) =>
        String(row.glAccount || "").trim().toUpperCase() ===
        trimmed.toUpperCase(),
    );

    return match?.glAccountName || null;
  } catch (error) {
    LOG.warn(
      `Could not resolve GL Account Name for "${trimmed}":`,
      error.message,
    );

    return null;
  }
}

module.exports = { resolveGLAccountName };
