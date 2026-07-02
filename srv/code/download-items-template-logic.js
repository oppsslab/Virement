const cds = require("@sap/cds");
const { buildTemplate } = require("./utils/items-template");

const LOG = cds.log("download-items-template-logic");

/**
 * Returns the RequestItems Excel template as base64.
 * @On(event = { "downloadItemsTemplate" })
 * @param {cds.Request} request - User information, tenant-specific CDS model, headers and query parameters
*/
module.exports = async function(request) {
  LOG.info("--- ON downloadItemsTemplate started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);

    const template = buildTemplate();

    LOG.info("Template generated:", template?.fileName);
    LOG.info("--- ON downloadItemsTemplate ended successfully ---");

    return template;
  } catch (error) {
    LOG.error("Error in download-items-template-logic:", error);
    return request.error(500, "Could not generate the items template.");
  }
};