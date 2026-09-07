"use strict";

const cds = require("@sap/cds");

const {
  buildGLGroupingTemplate,
} = require("./utils/gl-grouping-template");

const LOG = cds.log("download-gl-grouping-template-logic");

/**
 * Serves the GL Grouping mass-upload template.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
module.exports = function downloadGLGroupingTemplate(request) {
  LOG.info("Building GL Grouping upload template.");

  try {
    return buildGLGroupingTemplate();
  } catch (error) {
    LOG.error("Failed to build GL Grouping template:", error.message);

    return request.error(
      500,
      "Could not generate the GL Grouping template: " + error.message,
    );
  }
};
