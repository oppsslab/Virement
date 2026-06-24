const cds = require("@sap/cds");
const { calculateTotalAmount } = require("./utils/requests-calculation-utils");

const LOG = cds.log("requests-calculateValues-logic");

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
 * @On(event = { "calculateValues" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 *
 * Active action. Recalculates the parent Request's totalAmount from its
 * persisted items, then returns the updated Request. Draft-only srNo
 * resequencing is intentionally NOT performed here (no draft rows exist).
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- ON calculateValues (active) started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);
    const { RequestItems } = cds.entities(SERVICE_NAMESPACE);

    // 1. Resolve the Request ID from the action params.
    const requestId = resolveRequestId(request);
    LOG.info("Resolved Request ID:", requestId);

    if (!requestId) {
      LOG.error("No Request ID found in params.");
      return request.error(400, "Unable to determine the Request. Missing ID.");
    }

    // 2. Recalculate the total amount (shared calculation util).
    const totalAmount = await calculateTotalAmount({
      tx,
      RequestItems,
      requestId,
      request,
    });
    LOG.info("Calculated totalAmount:", totalAmount);

    // 3. Persist the recalculated total on the active Request.
    await tx.run(
      UPDATE(request.target).set({ totalAmount }).where({ ID: requestId }),
    );
    LOG.info("Updated totalAmount on:", request.target?.name);

    LOG.info("--- ON calculateValues (active) ended successfully ---");

    // 4. Return the freshly updated Request.
    return await tx.run(
      SELECT.one.from(request.target).where({ ID: requestId }),
    );
  } catch (error) {
    LOG.error("Error in requests-calculateValues-logic:", error);
    request.error(500, "An error occurred while calculating the total amount.");
  }
};
