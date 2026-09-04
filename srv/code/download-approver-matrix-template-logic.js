"use strict";

const cds = require("@sap/cds");

const {
  buildApproverMatrixTemplate,
} = require("./utils/approver-matrix-template");

const LOG = cds.log("download-approver-matrix-template-logic");

/**
 * Serves the Approver Matrix mass-upload template.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
module.exports = function downloadApproverMatrixTemplate(request) {
  LOG.info("Building Approver Matrix upload template.");

  try {
    return buildApproverMatrixTemplate();
  } catch (error) {
    LOG.error("Failed to build Approver Matrix template:", error.message);

    return request.error(
      500,
      "Could not generate the Approver Matrix template: " + error.message,
    );
  }
};
