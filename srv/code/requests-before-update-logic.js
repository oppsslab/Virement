const cds = require("@sap/cds");
const { recalcRequestTotal } = require("./utils/recalc-total-logic");

const LOG = cds.log("requests-before-update-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/* ------------------------------------------------------------------ *
 * Request ID resolution helper
 * ------------------------------------------------------------------ */

function resolveRequestId(request) {
  return (
    request.data?.ID || request.params?.[request.params.length - 1]?.ID || null
  );
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @Before(event = { "UPDATE" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 *
 * Fires when an already-created (active) Request is edited and saved
 * (draft activation of an existing record). Resequences the draft items'
 * srNo and recalculates the parent Request's totalAmount via the shared
 * util, so the saved record reflects any item additions/deletions.
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE UPDATE Requests started: recalc total ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Incoming request.data:", JSON.stringify(request.data || {}));
    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);

    // 1. Resolve the Request ID being saved.
    const requestId = resolveRequestId(request);
    LOG.info("Resolved Request ID:", requestId);

    if (!requestId) {
      LOG.warn("No Request ID found on update; skipping recalculation.");
      return;
    }

    // 2. Resequence srNo + recalculate the total on the draft (shared util).
    const { totalAmount, resequenced } = await recalcRequestTotal({
      tx,
      requestId,
      request,
      doResequence: true,
    });

    // 3. Reflect the recalculated total on the incoming payload so the
    //    active record is updated with the correct value during save.
    request.data.totalAmount = totalAmount;

    LOG.info(
      "Recalculation completed on update:",
      `total=${totalAmount}, resequenced=${resequenced} for request ${requestId}`,
    );

    LOG.info("--- BEFORE UPDATE Requests ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-before-update-logic:", error);
    request.error(500, "An error occurred while saving the request.");
  }
};
