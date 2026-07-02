const cds = require("@sap/cds");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");

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
 * all amount fields on the parent draft Request, then returns the updated draft Request.
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
  LOG.info("--- ON calculateValues (draft) started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);
    const { Requests } = cds.entities(SERVICE_NAMESPACE);
    const RequestsDraft = Requests.drafts;

    // 1. Resolve the Request ID from the action params.
    const requestId = resolveRequestId(request);
    LOG.info("Resolved Request ID:", requestId);

    if (!requestId) {
      LOG.error("No Request ID found in params.");
      return request.error(400, "Unable to determine the Request. Missing ID.");
    }

    // 2. Read the draft request to verify it exists
    const draftRequest = await tx.run(
      SELECT.one.from(RequestsDraft).where({ ID: requestId })
    );

    if (!draftRequest) {
      LOG.error("Draft request not found:", requestId);
      return request.error(404, "Draft request not found.");
    }

    LOG.info("Draft request ID validated:", requestId);

    // 3. Recalculate totals (includes resequencing)
    const amounts = await recalcAmountsByType(
      requestId,
      true  // doResequence
    );

    LOG.info("Recalculated amounts:", JSON.stringify(amounts));
    LOG.info("--- ON calculateValues (draft) ended successfully ---");

    // 4. Return the freshly updated draft Request
    return await tx.run(
      SELECT.one.from(request.target).where({ ID: requestId })
    );

  } catch (error) {
    LOG.error("Error in requests-drafts-calculateValues-logic:", error);
    request.error(500, "An error occurred while calculating the amounts.");
  }
};
