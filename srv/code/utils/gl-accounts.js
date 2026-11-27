const {
  fetchValueHelp,
  narrowToTerm,
  fetchExactByKey,
  ensureExactMatch,
} = require("./value-help");

const GL_ACCOUNT_PATH = "/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/GLAccountVH";

const SELECT_FIELDS =
  "CompanyCode,GLAccount,GLAccountName,GLAccountLongName,IsExpenseAccount";

/**
 * Reads GL accounts from S/4 for the given search term.
 *
 * The service reads its search parameter fuzzily, so a code such as
 * 1010 comes back with unrelated near matches (11010, 31010, 61010,
 * ...) in tow. The rows are narrowed against the typed text before
 * they reach the value help, so what the user typed sits at the top
 * and the near misses are gone.
 *
 * @param {string} term
 * @returns {Promise<Array<object>>}
 */
async function readGLAccounts(term, paging = {}) {
  const rows = await fetchValueHelp({
    path: GL_ACCOUNT_PATH,
    selectFields: SELECT_FIELDS,
    term,
    top: paging.top,
    skip: paging.skip,
    label: "GL accounts",
  });

  const mapped = rows.map((row) => ({
    glAccount: row.GLAccount,
    glAccountName: row.GLAccountName,
    glAccountLongName: row.GLAccountLongName,
    companyCode: row.CompanyCode,
    isExpenseAccount: row.IsExpenseAccount,
  }));

  const narrowed = narrowToTerm(mapped, term, {
    key: "glAccount",
    text: ["glAccountName", "glAccountLongName"],
  });

  /*
   * S/4's fuzzy search sometimes doesn't surface an exact code the
   * user typed directly within the page fetched (near-miss neighbours
   * outrank it instead) - without this, Fiori Elements' own
   * post-typing validation call ("glAccount eq '<value>'") sees no
   * exact match and silently reverts the field, even though the code
   * is genuinely valid. See utils/value-help.js's ensureExactMatch -
   * the same bug confirmed and fixed for Material Group (see
   * utils/material-groups.js).
   */
  return ensureExactMatch(narrowed, term, {
    key: "glAccount",
    fetchExact: async () => {
      const row = await fetchExactByKey({
        path: GL_ACCOUNT_PATH,
        selectFields: SELECT_FIELDS,
        key: term,
        label: "GL account",
      });

      return row
        ? {
            glAccount: row.GLAccount,
            glAccountName: row.GLAccountName,
            glAccountLongName: row.GLAccountLongName,
            companyCode: row.CompanyCode,
            isExpenseAccount: row.IsExpenseAccount,
          }
        : null;
    },
  });
}

module.exports = { readGLAccounts };
