const cds = require("@sap/cds");
const { recalcRequestTotal } = require("./utils/recalc-total-logic");

const LOG = cds.log("requests-drafts-calculateValues-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/* ------------------------------------------------------------------ *
 * Request ID resolution helper
 * ------------------------------------------------------------------ */

function resolveRequestId(request) {
  return request.params?.[request.params.length - 1]?.ID || null;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @On(event = { "calculateValues" }, entity = "ZSVC_PPS_VIREMENT.Requests(draft)")
 *
 * Draft action. Resequences the srNo of the draft items and recalculates
 * the parent Request's totalAmount, then returns the updated draft Request.
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- ON calculateValues (draft) started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);

    // 1. Resolve the Request ID from the action params.
    const requestId = resolveRequestId(request);
    LOG.info("Resolved Request ID:", requestId);

    if (!requestId) {
      LOG.error("No Request ID found in params.");
      return request.error(400, "Unable to determine the Request. Missing ID.");
    }

    // 2. Resequence srNo + recalculate the total on the draft (shared util).
    const { totalAmount, resequenced } = await recalcRequestTotal({
      tx,
      requestId,
      request,
      doResequence: true,
    });

    LOG.info(
      "Recalculation completed:",
      `total=${totalAmount}, resequenced=${resequenced} for request ${requestId}`,
    );

    LOG.info("--- ON calculateValues (draft) ended successfully ---");

    // 3. Return the freshly updated draft Request.
    return await tx.run(
      SELECT.one.from(request.target).where({ ID: requestId }),
    );
  } catch (error) {
    LOG.error("Error in requests-drafts-calculateValues-logic:", error);
    request.error(500, "An error occurred while calculating the total amount.");
  }
};
