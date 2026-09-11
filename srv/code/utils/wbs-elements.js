const { fetchValueHelp } = require("./value-help");

// Standard Gateway prefix + the double slash before the entity set -
// the two prior attempts each 404'd differently: the plain standard
// path ("/sap/opu/odata/sap/API_WBS_ELEMENT_SRV/A_WBSElement") got a
// structured OData error ("No service found for namespace '', name
// 'API_WBS_ELEMENT_SRV'"), while the non-standard prefix without the
// double slash ("/sap/API_WBSELEMENT_SRV//A_WBSElement") 404'd with a
// bare ICM "Service cannot be reached" page (not even OData-level).
const WBS_ELEMENT_PATH = "/sap/opu/odata/sap/API_WBS_ELEMENT_SRV//A_WBSElement";

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
