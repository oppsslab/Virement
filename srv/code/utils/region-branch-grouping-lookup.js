"use strict";

const cds = require("@sap/cds");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Looks up the Region and Branch for a Cost Centre from the Region &
 * Branch Grouping master data (see db/schema.cds RegionBranchGrouping
 * entity), for the read-only Region / Branch display fields on
 * RequestItems (Virement item tables).
 *
 * Both values come from the same row, so this is a single lookup
 * rather than two separate ones.
 *
 * @param {object} tx - an active cds.tx()
 * @param {string} costCentre
 * @returns {Promise<{region: string|null, branch: string|null}>}
 */
async function resolveRegionBranch(tx, costCentre) {
  const trimmed = String(costCentre || "").trim();

  if (!trimmed) {
    return { region: null, branch: null };
  }

  const { RegionBranchGrouping } = cds.entities(SERVICE_NAMESPACE);

  const row = await tx.run(
    SELECT.one
      .from(RegionBranchGrouping)
      .columns("region", "branch")
      .where({ costCentre: trimmed }),
  );

  return {
    region: row?.region || null,
    branch: row?.branch || null,
  };
}

module.exports = { resolveRegionBranch };
