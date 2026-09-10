"use strict";

const cds = require("@sap/cds");

const { readCostCenters } = require("./cost-centers");

const LOG = cds.log("cost-centre-description-lookup");

/**
 * Looks up the Cost Centre Description (name) for a Cost Centre from
 * S/4 (the same live lookup the Cost Centre value help itself uses),
 * for the read-only Cost Centre Description display field on
 * RequestItems (Virement item tables).
 *
 * Best-effort: an S/4 read failure (timeout, destination issue) is
 * logged and resolves to null rather than blocking the item
 * create/update - a description is a display convenience, not
 * required data.
 *
 * @param {string} costCentre
 * @returns {Promise<string|null>}
 */
async function resolveCostCentreDescription(costCentre) {
  const trimmed = String(costCentre || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    const rows = await readCostCenters(trimmed);

    const match = rows.find(
      (row) =>
        String(row.costCentre || "").trim().toUpperCase() ===
        trimmed.toUpperCase(),
    );

    return match?.costCentreName || null;
  } catch (error) {
    LOG.warn(
      `Could not resolve Cost Centre Description for "${trimmed}":`,
      error.message,
    );

    return null;
  }
}

module.exports = { resolveCostCentreDescription };
