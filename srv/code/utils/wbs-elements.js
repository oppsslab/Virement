const { fetchValueHelp } = require("./value-help");

const WBS_ELEMENT_PATH = "/sap/opu/odata/sap/API_WBS_ELEMENT_SRV/A_WBSElement";

const SELECT_FIELDS =
  "WBSElementInternalID,WBSElementExternalID,WBSElementIsBillingElement";

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
    filter: `startswith(WBSElementExternalID,'${literal}')`,
    top: paging.top,
    skip: paging.skip,
    label: "WBS elements",
  });

  return rows.map((row) => ({
    wbsElement: row.WBSElementExternalID,
    wbsElementInternalID: row.WBSElementInternalID,
    isBillingElement: row.WBSElementIsBillingElement,
  }));
}

module.exports = { readWBSElements };
