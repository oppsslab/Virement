const cds = require("@sap/cds");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");
const { refreshDraftApproverPreview } = require("./utils/apply-approver-plan");

const LOG = cds.log("requestitems-drafts-after-create-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

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
 * Also refreshes the CAP-owned approver preview (see
 * utils/apply-approver-plan.js) using the freshly recalculated
 * amount, so requestors see the resolved approver as soon as they add
 * a line item - without needing to press the Calculate button.
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

    // 3. Refresh the CAP-owned approver preview against the new totals.
    const tx = cds.tx(request);

    const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

    await refreshDraftApproverPreview({
      tx,
      RequestsDraft: Requests.drafts,
      RequestApproversDraft: RequestApprovers.drafts,
      requestId,
      amounts,
    });

    LOG.info("--- AFTER CREATE RequestItems.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-after-create-logic:", error);
    // After-phase failure should not corrupt the create result; log only.
  }
};
