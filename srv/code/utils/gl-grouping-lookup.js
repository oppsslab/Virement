"use strict";

const cds = require("@sap/cds");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Looks up the GL Group for a GL Account from the GL Grouping master
 * data (see db/schema.cds GLGrouping entity), for the read-only GL
 * Group display field on RequestItems (Virement item tables).
 *
 * A GL Account with no matching GL Grouping row (or duplicated across
 * more than one row - the source data has one known duplicate)
 * resolves to whatever a single-row lookup finds, or null if none.
 *
 * @param {object} tx - an active cds.tx()
 * @param {string} glAccount
 * @returns {Promise<string|null>}
 */
async function resolveGLGroup(tx, glAccount) {
  const trimmed = String(glAccount || "").trim();

  if (!trimmed) {
    return null;
  }

  const { GLGrouping } = cds.entities(SERVICE_NAMESPACE);

  const row = await tx.run(
    SELECT.one
      .from(GLGrouping)
      .columns("glGroup")
      .where({ glAccount: trimmed }),
  );

  return row?.glGroup || null;
}

/**
 * Looks up the Asset Type for a GL Account from the GL Grouping
 * master data (see db/schema.cds GLGrouping entity), for the
 * read-only Asset Type field on RequestItems (Virement item tables)
 * that drives whether Asset Status is shown/editable on that item.
 *
 * A GL Account with no matching GL Grouping row (or duplicated across
 * more than one row) resolves to whatever a single-row lookup finds,
 * or null if none.
 *
 * @param {object} tx - an active cds.tx()
 * @param {string} glAccount
 * @returns {Promise<string|null>}
 */
async function resolveAssetType(tx, glAccount) {
  const trimmed = String(glAccount || "").trim();

  if (!trimmed) {
    return null;
  }

  const { GLGrouping } = cds.entities(SERVICE_NAMESPACE);

  const row = await tx.run(
    SELECT.one
      .from(GLGrouping)
      .columns("assetType")
      .where({ glAccount: trimmed }),
  );

  return row?.assetType || null;
}

module.exports = { resolveGLGroup, resolveAssetType };
