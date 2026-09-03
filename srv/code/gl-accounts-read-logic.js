"use strict";

const cds = require("@sap/cds");

const { readGLAccounts } = require("./utils/gl-accounts");
const { extractSearchTerm, extractPaging } = require("./utils/value-help");

const LOG = cds.log("gl-accounts-read-logic");

const FIELD = "glAccount";

/**
 * Serves the GL account value help from S/4.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<object[]>}
 */
module.exports = async function readGLAccountsHandler(request) {
  const select = (request.query && request.query.SELECT) || {};

  const term = extractSearchTerm(select, FIELD);

  const paging = extractPaging(select);

  LOG.info(`GL account value help, term: "${term}" (top ${paging.top}, skip ${paging.skip})`);

  try {
    return await readGLAccounts(term, paging);
  } catch (error) {
    LOG.error("GL account value help failed:", error.message);

    return request.reject(error.statusCode || 502, error.message);
  }
};
