"use strict";

const cds = require("@sap/cds");

const {
  buildFunctionalDepartmentGroupingTemplate,
} = require("./utils/functional-department-grouping-template");

const LOG = cds.log("download-functional-department-grouping-template-logic");

/**
 * Serves the Functional Department Grouping mass-upload template.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
module.exports = function downloadFunctionalDepartmentGroupingTemplate(
  request,
) {
  LOG.info("Building Functional Department Grouping upload template.");

  try {
    return buildFunctionalDepartmentGroupingTemplate();
  } catch (error) {
    LOG.error(
      "Failed to build Functional Department Grouping template:",
      error.message,
    );

    return request.error(
      500,
      "Could not generate the Functional Department Grouping template: " +
        error.message,
    );
  }
};
