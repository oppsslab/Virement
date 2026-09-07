"use strict";

const cds = require("@sap/cds");

const {
  buildDepartmentGroupingTemplate,
} = require("./utils/department-grouping-template");

const LOG = cds.log("download-department-grouping-template-logic");

/**
 * Serves the Department Grouping mass-upload template.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
module.exports = function downloadDepartmentGroupingTemplate(request) {
  LOG.info("Building Department Grouping upload template.");

  try {
    return buildDepartmentGroupingTemplate();
  } catch (error) {
    LOG.error(
      "Failed to build Department Grouping template:",
      error.message,
    );

    return request.error(
      500,
      "Could not generate the Department Grouping template: " +
        error.message,
    );
  }
};
