"use strict";

const cds = require("@sap/cds");

const {
  buildRegionBranchGroupingTemplate,
} = require("./utils/region-branch-grouping-template");

const LOG = cds.log("download-region-branch-grouping-template-logic");

/**
 * Serves the Region & Branch Grouping mass-upload template.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
module.exports = function downloadRegionBranchGroupingTemplate(request) {
  LOG.info("Building Region & Branch Grouping upload template.");

  try {
    return buildRegionBranchGroupingTemplate();
  } catch (error) {
    LOG.error(
      "Failed to build Region & Branch Grouping template:",
      error.message,
    );

    return request.error(
      500,
      "Could not generate the Region & Branch Grouping template: " +
        error.message,
    );
  }
};
