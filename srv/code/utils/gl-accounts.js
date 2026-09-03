const { fetchValueHelp } = require("./value-help");

const GL_ACCOUNT_PATH = "/sap/opu/odata/sap/ZFGL_GW_JV_VALUEHELP_O2/GLAccountVH";

const SELECT_FIELDS =
  "CompanyCode,GLAccount,GLAccountName,GLAccountLongName,IsExpenseAccount";

/**
 * Reads GL accounts from S/4 for the given search term.
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

  return rows.map((row) => ({
    glAccount: row.GLAccount,
    glAccountName: row.GLAccountName,
    glAccountLongName: row.GLAccountLongName,
    companyCode: row.CompanyCode,
    isExpenseAccount: row.IsExpenseAccount,
  }));
}

module.exports = { readGLAccounts };
