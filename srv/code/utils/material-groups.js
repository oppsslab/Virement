const { fetchValueHelp, narrowToTerm } = require("./value-help");

const MATERIAL_GROUP_PATH =
  "/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/MaterialGroupVH";

const SELECT_FIELDS = "MaterialGroup,MaterialGroupDescription";

/**
 * Reads material groups from S/4 for the given search term.
 *
 * The service reads its search parameter fuzzily, so a full code such
 * as 741014001 comes back with its neighbours (741014101, 710014001)
 * in tow. The rows are narrowed against the typed text before they
 * reach the value help, so what the user typed sits at the top and the
 * near misses are gone.
 *
 * @param {string} term
 * @returns {Promise<Array<object>>}
 */
async function readMaterialGroups(term, paging = {}) {
  const rows = await fetchValueHelp({
    path: MATERIAL_GROUP_PATH,
    selectFields: SELECT_FIELDS,
    term,
    top: paging.top,
    skip: paging.skip,
    label: "material groups",
  });

  const mapped = rows.map((row) => ({
    materialGroup: row.MaterialGroup,
    materialGroupDescription: row.MaterialGroupDescription,
  }));

  return narrowToTerm(mapped, term, {
    key: "materialGroup",
    text: ["materialGroupDescription"],
  });
}

module.exports = { readMaterialGroups };
