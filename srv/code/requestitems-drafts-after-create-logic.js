const cds = require("@sap/cds");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");
const { refreshDraftApproverPreview } = require("./utils/apply-approver-plan");

const LOG = cds.log("requestitems-drafts-after-create-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/*
 * A bulk upload (or any deep-insert of several items at once) fires
 * this AFTER CREATE hook once per item, in quick succession. Both
 * recalcAmountsByType's srNo resequencing and
 * refreshDraftApproverPreview's delete-then-insert are read-modify-
 * write sequences against the SAME parent request's siblings/
 * approvers - running several of them concurrently for the same
 * request_ID let them race and interleave (one invocation's DELETE
 * running against rows another invocation had already re-inserted,
 * or a resequence running before a sibling item from the same batch
 * had committed), producing scrambled srNo values and duplicated
 * approver rows.
 *
 * This queues invocations per requestId so they always run one at a
 * time, however many items land in the same batch - it does not
 * reduce how many times the recalculation runs, only guarantees none
 * of them overlap.
 */
const perRequestQueue = new Map();

function runSerializedPerRequest(requestId, fn) {
  const previous = perRequestQueue.get(requestId) || Promise.resolve();

  const next = previous.then(fn, fn).finally(() => {
    if (perRequestQueue.get(requestId) === next) {
      perRequestQueue.delete(requestId);
    }
  });

  perRequestQueue.set(requestId, next);

  return next;
}

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

    // 2. & 3. Recalculate amounts/resequence srNo, then refresh the
    //    approver preview - serialized per request_ID (see
    //    runSerializedPerRequest above) so a bulk upload's many
    //    back-to-back item creates can't race each other here.
    await runSerializedPerRequest(requestId, async () => {
      // Recalculate the parent amounts and resequence sibling srNo
      // values (shared util, same call the calculateValues action
      // makes).
      const amounts = await recalcAmountsByType(
        requestId,
        true  // doResequence
      );

      LOG.info(
        "Recalculation completed for request",
        `${requestId}: ${JSON.stringify(amounts)}`,
      );

      // Refresh the CAP-owned approver preview against the new totals.
      const tx = cds.tx(request);

      const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

      await refreshDraftApproverPreview({
        tx,
        RequestsDraft: Requests.drafts,
        RequestApproversDraft: RequestApprovers.drafts,
        requestId,
        amounts,
      });
    });

    LOG.info("--- AFTER CREATE RequestItems.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-after-create-logic:", error);
    // After-phase failure should not corrupt the create result; log only.
  }
};
