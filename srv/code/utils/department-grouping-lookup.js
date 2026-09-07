"use strict";

const cds = require("@sap/cds");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Looks up the Department for a Cost Centre from the Department
 * Grouping master data (see db/schema.cds DepartmentGrouping entity),
 * for the read-only Department display field on RequestItems
 * (Virement item tables).
 *
 * A Cost Centre with no matching Department Grouping row (or
 * duplicated across more than one row - the source data has one
 * known duplicate) resolves to whatever a single-row lookup finds, or
 * null if none.
 *
 * @param {object} tx - an active cds.tx()
 * @param {string} costCentre
 * @returns {Promise<string|null>}
 */
async function resolveDepartment(tx, costCentre) {
  const trimmed = String(costCentre || "").trim();

  if (!trimmed) {
    return null;
  }

  const { DepartmentGrouping } = cds.entities(SERVICE_NAMESPACE);

  const row = await tx.run(
    SELECT.one
      .from(DepartmentGrouping)
      .columns("department")
      .where({ costCentre: trimmed }),
  );

  return row?.department || null;
}

module.exports = { resolveDepartment };
