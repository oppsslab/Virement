const cds = require("@sap/cds");
const { calculateAmountsByType } = require("./utils/requests-calculation-utils");

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
 * Active action. Recalculates all amount fields from the parent Request's
 * persisted items, then returns the updated Request.
 *
 * Calculates (independent sums, not combined):
 *   - supplementAmount (sum of all item.supplementAmount)
 *   - returnAmount (sum of all item.returnAmount)
 *   - transferInAmount (sum of all item.transferInAmount)
 *   - transferOutAmount (sum of all item.transferOutAmount)
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- ON calculateValues Requests started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);
    const { Requests, RequestItems } = cds.entities(SERVICE_NAMESPACE);

    // 1. Resolve the Request ID from the action params.
    const requestId = resolveRequestId(request);
    LOG.info("Resolved Request ID:", requestId);

    if (!requestId) {
      LOG.error("No Request ID found in params.");
      return request.error(400, "Unable to determine the Request. Missing ID.");
    }

    // 2. Read the request to verify it exists
    const currentRequest = await tx.run(
      SELECT.one.from(Requests).where({ ID: requestId })
    );

    if (!currentRequest) {
      LOG.error("Request not found:", requestId);
      return request.error(404, "Request not found.");
    }

    LOG.info("Request ID validated:", requestId);

    // 3. Recalculate all amounts
    const amounts = await calculateAmountsByType({
      tx,
      RequestItems,
      requestId,
      request,
    });

    LOG.info("Calculated amounts:", JSON.stringify(amounts));

    // 4. Persist all calculated amounts on the active Request
    await tx.run(
      UPDATE(request.target).set({
        supplementAmount: amounts.supplementAmount,
        returnAmount: amounts.returnAmount,
        transferInAmount: amounts.transferInAmount,
        transferOutAmount: amounts.transferOutAmount
      }).where({ ID: requestId })
    );

    LOG.info("Updated all amounts on:", request.target?.name);
    LOG.info("--- ON calculateValues Requests ended successfully ---");

    // 5. Return the freshly updated Request
    return await tx.run(
      SELECT.one.from(request.target).where({ ID: requestId })
    );

  } catch (error) {
    LOG.error("Error in requests-calculateValues-logic:", error);
    request.error(500, "An error occurred while calculating the amounts.");
  }
};
