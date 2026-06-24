const cds = require("@sap/cds");
const insertRequestHistory = require("./insert-request-history");
const { HISTORY_MESSAGES } = require("./utils/history-messages");

const LOG = cds.log("requests-after-create-logic");

/**
 * @After(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 * @param {(Object|Object[])} results
 * @param {cds.Request} request
 */
module.exports = async function (results, request) {
  LOG.info("--- AFTER CREATE Requests started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Results:", JSON.stringify(results || {}));

    const result = Array.isArray(results) ? results[0] : results;
    const requestId = result?.ID || request.data?.ID;

    LOG.info("Resolved Request ID for history:", requestId);

    if (!requestId) {
      LOG.warn("No Request ID found. Skipping history insert.");
      return;
    }

    const inserted = await insertRequestHistory(
      request,
      requestId,
      HISTORY_MESSAGES.SUBMITTED,
    );

    LOG.info("RequestHistory inserted:", inserted);
    LOG.info("--- AFTER CREATE Requests ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-after-create-logic (non-fatal):", error);
  }
};
