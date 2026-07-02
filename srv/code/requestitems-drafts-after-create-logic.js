const cds = require("@sap/cds");
const { recalcRequestTotal } = require("./utils/recalc-total-logic");

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
 * totalAmount and resequences the srNo of all sibling items.
 *
 * @param {object} data - the created item (carries request_ID)
 * @param {cds.Request} request
 */
module.exports = async function (data, request) {
  LOG.info("--- AFTER CREATE RequestItems started: recalc total ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Created item data:", JSON.stringify(data || {}));

    const tx = cds.tx(request);

    // 1. Resolve the parent Request ID from the created item.
    const requestId = resolveParentRequestId(data);
    LOG.info("Resolved parent request_ID:", requestId);

    if (!requestId) {
      LOG.warn("No request_ID found on created item; skipping recalculation.");
      return;
    }

    // 2. Recalculate the parent total and resequence sibling srNo values.
    const { totalAmount, resequenced } = await recalcRequestTotal({
      tx,
      requestId,
      request,
    });

    LOG.info(
      "Recalculation completed:",
      `total=${totalAmount}, resequenced=${resequenced} for request ${requestId}`,
    );

    LOG.info("--- AFTER CREATE RequestItems ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-after-create-logic:", error);
    // After-phase failure should not corrupt the create result; log only.
  }
};
