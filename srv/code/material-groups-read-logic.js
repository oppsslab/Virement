"use strict";

const cds = require("@sap/cds");

const { readMaterialGroups } = require("./utils/material-groups");
const { extractSearchTerm, extractPaging } = require("./utils/value-help");

const LOG = cds.log("material-groups-read-logic");

const FIELD = "materialGroup";

/**
 * Serves the material group value help from S/4.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<object[]>}
 */
module.exports = async function readMaterialGroupsHandler(request) {
  const select = (request.query && request.query.SELECT) || {};

  const term = extractSearchTerm(select, FIELD);

  const paging = extractPaging(select);

  LOG.info(`Material group value help, term: "${term}" (top ${paging.top}, skip ${paging.skip})`);

  try {
    return await readMaterialGroups(term, paging);
  } catch (error) {
    LOG.error("Material group value help failed:", error.message);

    return request.reject(error.statusCode || 502, error.message);
  }
};
