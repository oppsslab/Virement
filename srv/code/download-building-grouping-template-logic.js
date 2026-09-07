"use strict";

const cds = require("@sap/cds");

const {
  buildBuildingGroupingTemplate,
} = require("./utils/building-grouping-template");

const LOG = cds.log("download-building-grouping-template-logic");

/**
 * Serves the Building Grouping mass-upload template.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
module.exports = function downloadBuildingGroupingTemplate(request) {
  LOG.info("Building Building Grouping upload template.");

  try {
    return buildBuildingGroupingTemplate();
  } catch (error) {
    LOG.error(
      "Failed to build Building Grouping template:",
      error.message,
    );

    return request.error(
      500,
      "Could not generate the Building Grouping template: " + error.message,
    );
  }
};
