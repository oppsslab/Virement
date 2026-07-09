const cds = require("@sap/cds");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");

const LOG = cds.log("requests-before-update-logic");

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
 * srNo and recalculates all amount fields on the parent Request via the shared
 * util, so the saved record reflects any item additions/deletions.
 *
 * Recalculates:
 *   - supplementAmount
 *   - returnAmount
 *   - transferInAmount
 *   - transferOutAmount
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE UPDATE Requests started ---");

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

    // 2. Resequence srNo + recalculate all amounts on the draft (shared util).
    const amounts = await recalcAmountsByType(
      requestId,
      true  // doResequence
    );

    // 3. Reflect all recalculated amounts on the incoming payload so the
    //    active record is updated with the correct values during save.
    request.data.supplementAmount = amounts.supplementAmount;
    request.data.returnAmount = amounts.returnAmount;
    request.data.transferInAmount = amounts.transferInAmount;
    request.data.transferOutAmount = amounts.transferOutAmount;

    LOG.info(
      "Recalculation completed on update:",
      `amounts=${JSON.stringify(amounts)}, resequenced=true for request ${requestId}`,
    );

    LOG.info("--- BEFORE UPDATE Requests ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-before-update-logic:", error);
    request.error(500, "An error occurred while saving the request.");
  }
};
