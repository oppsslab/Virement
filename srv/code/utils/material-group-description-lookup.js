"use strict";

const cds = require("@sap/cds");

const { readMaterialGroups } = require("./material-groups");

const LOG = cds.log("material-group-description-lookup");

/**
 * Looks up the Material Group Description for a Material Group from
 * S/4 (the same live lookup the Material value help itself uses), for
 * the read-only Material Group Description display field on
 * RequestItems (Virement item tables).
 *
 * Best-effort: an S/4 read failure (timeout, destination issue) is
 * logged and resolves to null rather than blocking the item
 * create/update - a description is a display convenience, not
 * required data.
 *
 * @param {string} materialGroup
 * @returns {Promise<string|null>}
 */
async function resolveMaterialGroupDescription(materialGroup) {
  const trimmed = String(materialGroup || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    const rows = await readMaterialGroups(trimmed);

    const match = rows.find(
      (row) =>
        String(row.materialGroup || "").trim().toUpperCase() ===
        trimmed.toUpperCase(),
    );

    return match?.materialGroupDescription || null;
  } catch (error) {
    LOG.warn(
      `Could not resolve Material Group Description for "${trimmed}":`,
      error.message,
    );

    return null;
  }
}

module.exports = { resolveMaterialGroupDescription };
