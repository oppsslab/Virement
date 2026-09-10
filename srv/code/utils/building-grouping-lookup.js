"use strict";

const cds = require("@sap/cds");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Looks up the Building Name for a Cost Centre from the Building
 * Grouping master data (see db/schema.cds BuildingGrouping entity),
 * for the read-only Building Name display field on RequestItems
 * (Virement item tables). The Building Name is the matched row's
 * costCentreDescription.
 *
 * A Cost Centre with no matching Building Grouping row (or duplicated
 * across more than one row) resolves to whatever a single-row lookup
 * finds, or null if none.
 *
 * @param {object} tx - an active cds.tx()
 * @param {string} costCentre
 * @returns {Promise<string|null>}
 */
async function resolveBuildingName(tx, costCentre) {
  const trimmed = String(costCentre || "").trim();

  if (!trimmed) {
    return null;
  }

  const { BuildingGrouping } = cds.entities(SERVICE_NAMESPACE);

  const row = await tx.run(
    SELECT.one
      .from(BuildingGrouping)
      .columns("costCentreDescription")
      .where({ costCentre: trimmed }),
  );

  return row?.costCentreDescription || null;
}

module.exports = { resolveBuildingName };
