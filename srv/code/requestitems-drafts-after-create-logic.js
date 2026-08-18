const cds = require("@sap/cds");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");

const LOG = cds.log("requestitems-drafts-after-create-logic");

/* ------------------------------------------------------------------ *
 * Parent resolution helper
 * ------------------------------------------------------------------ */

function resolveParentRequestId(data) {
  if (!data) {
    return null;
  }

  return data.request_ID || (data.request && data.request.ID) || null;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @After(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems(draft)")
 *
 * After a draft item is created, recalculates the parent Request's
 * amount fields and resequences the srNo of all sibling items.
 *
 * Calculates (independent sums, not combined):
 *   - supplementAmount, returnAmount, transferInAmount, transferOutAmount
 *
 * @param {object} data - the created item (carries request_ID)
 * @param {cds.Request} request
 */
module.exports = async function (data, request) {
  LOG.info("--- AFTER CREATE RequestItems.drafts started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Created item data:", JSON.stringify(data || {}));

    // 1. Resolve the parent Request ID from the created item.
    const requestId = resolveParentRequestId(data);
    LOG.info("Resolved parent request_ID:", requestId);

    if (!requestId) {
      LOG.warn("No request_ID found on created item; skipping recalculation.");
      return;
    }

    // 2. Recalculate the parent amounts and resequence sibling srNo values
    //    (shared util, same call the calculateValues action makes).
    const amounts = await recalcAmountsByType(
      requestId,
      true  // doResequence
    );

    LOG.info(
      "Recalculation completed for request",
      `${requestId}: ${JSON.stringify(amounts)}`,
    );

    LOG.info("--- AFTER CREATE RequestItems.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-after-create-logic:", error);
    // After-phase failure should not corrupt the create result; log only.
  }
};
