const {
  fetchValueHelp,
  narrowToTerm,
  fetchExactByKey,
  ensureExactMatch,
} = require("./value-help");

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

  const narrowed = narrowToTerm(mapped, term, {
    key: "materialGroup",
    text: ["materialGroupDescription"],
  });

  /*
   * S/4's fuzzy search sometimes doesn't surface an exact code the
   * user typed directly within the page fetched (near-miss neighbours
   * outrank it instead) - without this, Fiori Elements' own
   * post-typing validation call ("materialGroup eq '<value>'") sees
   * no exact match and silently reverts the field, even though the
   * code is genuinely valid. See utils/value-help.js's
   * ensureExactMatch.
   */
  return ensureExactMatch(narrowed, term, {
    key: "materialGroup",
    fetchExact: async () => {
      const row = await fetchExactByKey({
        path: MATERIAL_GROUP_PATH,
        selectFields: SELECT_FIELDS,
        key: term,
        label: "material group",
      });

      return row
        ? {
            materialGroup: row.MaterialGroup,
            materialGroupDescription: row.MaterialGroupDescription,
          }
        : null;
    },
  });
}

module.exports = { readMaterialGroups };
