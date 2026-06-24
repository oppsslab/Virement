const cds = require("@sap/cds");
const { getLocalDateParts } = require("./utils/date-utils");
const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("requests-drafts-before-create-logic");

/**
 * @Before(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE Requests.drafts started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Incoming request.data:", JSON.stringify(request.data || {}));
    LOG.info("Request params:", JSON.stringify(request.params || []));

    request.data = request.data || {};

    const { year } = getLocalDateParts(new Date());

    request.data.requestor = request.data.requestor || request.user?.id;
    request.data.fiscalYear = request.data.fiscalYear || String(year);
    request.data.status_code = request.data.status_code ?? REQUEST_STATUS.DRAFT;

    LOG.info("Set requestor:", request.data.requestor);
    LOG.info("Set fiscalYear:", request.data.fiscalYear);
    LOG.info("Set status_code:", request.data.status_code);

    LOG.info("Final request.data:", JSON.stringify(request.data || {}));
    LOG.info("--- BEFORE CREATE Requests.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-drafts-before-create-logic.", error);
    request.error(
      500,
      "An error occurred while initializing the request draft.",
    );
  }
};
