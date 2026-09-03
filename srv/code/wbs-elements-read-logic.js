"use strict";

const cds = require("@sap/cds");

const { readWBSElements } = require("./utils/wbs-elements");
const { extractSearchTerm, extractPaging } = require("./utils/value-help");

const LOG = cds.log("wbs-elements-read-logic");

const FIELD = "wbsElement";

/**
 * Serves the WBS element value help from S/4.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<object[]>}
 */
module.exports = async function readWBSElementsHandler(request) {
  const select = (request.query && request.query.SELECT) || {};

  const term = extractSearchTerm(select, FIELD);

  const paging = extractPaging(select);

  LOG.info(`WBS element value help, term: "${term}" (top ${paging.top}, skip ${paging.skip})`);

  try {
    return await readWBSElements(term, paging);
  } catch (error) {
    LOG.error("WBS element value help failed:", error.message);

    return request.reject(error.statusCode || 502, error.message);
  }
};
