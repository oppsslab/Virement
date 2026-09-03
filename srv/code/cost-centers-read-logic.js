"use strict";

const cds = require("@sap/cds");

const { readCostCenters } = require("./utils/cost-centers");
const { extractSearchTerm, extractPaging } = require("./utils/value-help");

const LOG = cds.log("cost-centers-read-logic");

const FIELD = "costCentre";

/**
 * Serves the cost centre value help from S/4.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<object[]>}
 */
module.exports = async function readCostCentersHandler(request) {
  const select = (request.query && request.query.SELECT) || {};

  const term = extractSearchTerm(select, FIELD);

  const paging = extractPaging(select);

  LOG.info(
    `Cost centre value help, term: "${term}" ` +
      `(top ${paging.top}, skip ${paging.skip})`
  );

  try {
    return await readCostCenters(term, paging);
  } catch (error) {
    LOG.error("Cost centre value help failed:", error.message);

    return request.reject(error.statusCode || 502, error.message);
  }
};
