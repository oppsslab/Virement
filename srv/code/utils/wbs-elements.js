const cds = require("@sap/cds");

const { fetchValueHelp } = require("./value-help");

const LOG = cds.log("wbs-elements");

// Two prior services were tried and abandoned before this one:
//   - API_WBSELEMENT_SRV/A_WBSElement: worked, but has no Cost Center
//     field of any kind (confirmed against its live $metadata).
//   - API_ENTERPRISE_PROJECT_SRV/A_EnterpriseProjectElement: has
//     ResponsibleCostCenter, but returned a clean 200 with 0 rows for
//     every query once activated - most likely the destination's
//     technical user isn't authorized for Enterprise Project data,
//     even though the service itself is reachable.
//
// This is a purpose-built custom value help service instead of a
// standard SAP API - confirmed via a live sample response carrying
// real data (WBSElement, WBSDescription, ResponsibleCostCenter,
// CompanyCode, ProfitCenter, Project, ProjectDescription; no
// WBSElementInternalID or billing-element flag, hence those two
// columns are dropped below rather than left permanently blank).
const WBS_ELEMENT_PATH = "/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/WBSElementVH";

const SELECT_FIELDS = "WBSElement,WBSDescription,ResponsibleCostCenter";

/**
 * Escapes single quotes for an OData string literal.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeODataLiteral(value) {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Reads WBS elements from S/4 for the given prefix.
 *
 * This service filters rather than searches, so the prefix goes into a
 * startswith. An empty prefix matches everything, which is what the
 * value help should show before the user types.
 *
 * @param {string} prefix
 * @returns {Promise<Array<object>>}
 */
async function readWBSElements(prefix, paging = {}) {
  const literal = escapeODataLiteral(prefix).toUpperCase();

  const rows = await fetchValueHelp({
    path: WBS_ELEMENT_PATH,
    selectFields: SELECT_FIELDS,
    filter: `startswith(WBSElement,'${literal}')`,
    top: paging.top,
    skip: paging.skip,
    label: "WBS elements",
  });

  /*
   * This custom value help occasionally returns a row with a blank
   * WBSElement (the entity's key) alongside a real description -
   * confirmed live: {"WBSElement":"","WBSDescription":"INSTL.
   * PAPANTANDA","ResponsibleCostCenter":""}. An OData row with an
   * empty (or, worse, duplicated-across-rows-empty) key breaks the
   * client's ability to bind/identify it - dropped here rather than
   * surfaced, since a blank WBS is never a usable value help
   * selection anyway.
   */
  return rows
    .filter((row) => String(row.WBSElement || "").trim())
    .map((row) => ({
      wbsElement: row.WBSElement,
      wbsDescription: row.WBSDescription,
      responsibleCostCenter: row.ResponsibleCostCenter,
    }));
}

/**
 * Looks up the Description and Responsible Cost Center for a single
 * WBS Element from S/4 (the same live lookup the WBS value help
 * itself uses), for the read-only WBS Description display field and
 * the auto-populated Cost Centre field on RequestItems (see
 * requestitems-drafts-before-create/update-logic.js - a Project
 * item's Cost Centre column is hidden in the UI, but is still
 * populated server-side from the WBS's Responsible Cost Center so
 * downstream logic that keys off costCentre, e.g. Department/Region
 * derivation, works for Project items too).
 *
 * Best-effort: an S/4 read failure (timeout, destination issue) is
 * logged and resolves to nulls rather than blocking the item
 * create/update - neither field is required data.
 *
 * @param {string} wbsElement
 * @returns {Promise<{wbsDescription: string|null, responsibleCostCenter: string|null}>}
 */
async function resolveWBSDetails(wbsElement) {
  const trimmed = String(wbsElement || "").trim();

  if (!trimmed) {
    return { wbsDescription: null, responsibleCostCenter: null };
  }

  try {
    const rows = await readWBSElements(trimmed);

    const match = rows.find(
      (row) =>
        String(row.wbsElement || "").trim().toUpperCase() ===
        trimmed.toUpperCase(),
    );

    return {
      wbsDescription: match?.wbsDescription || null,
      responsibleCostCenter: match?.responsibleCostCenter || null,
    };
  } catch (error) {
    LOG.warn(
      `Could not resolve WBS details for "${trimmed}":`,
      error.message,
    );

    return { wbsDescription: null, responsibleCostCenter: null };
  }
}

module.exports = { readWBSElements, resolveWBSDetails };
