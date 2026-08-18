const cds = require("@sap/cds");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");

const LOG = cds.log("requestitems-drafts-after-update-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/* ------------------------------------------------------------------ *
 * Parent resolution helper
 * ------------------------------------------------------------------ */

/**
 * Resolves the parent Request ID for an updated draft item.
 *
 * A PATCH on a single item does not necessarily echo request_ID back in
 * the result payload, so fall back to reading the draft item by its own
 * key when the association is absent.
 *
 * @param {object} data - the updated item
 * @param {cds.Request} request
 * @returns {Promise<string|null>} the parent Requests.ID, or null
 */
async function resolveParentRequestId(data, request) {
  const direct = data?.request_ID || (data?.request && data.request.ID) || null;

  if (direct) {
    return direct;
  }

  const itemId = data?.ID || request.params?.[request.params.length - 1]?.ID;

  if (!itemId) {
    return null;
  }

  const { RequestItems } = cds.entities(SERVICE_NAMESPACE);

  const item = await SELECT.one
    .from(RequestItems.drafts)
    .columns("request_ID")
    .where({ ID: itemId });

  return item?.request_ID || null;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @After(event = { "UPDATE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems(draft)")
 *
 * After a draft item is changed, recalculates the parent Request's
 * amount fields so the header stays in sync with its line items without
 * requiring a manual calculateValues (Calculate button) call.
 *
 * Calculates (independent sums, not combined):
 *   - supplementAmount, returnAmount, transferInAmount, transferOutAmount
 *
 * srNo is NOT resequenced here: an update never changes the number of
 * items, and resequencing would issue pointless writes on every
 * keystroke-sized PATCH.
 *
 * @param {object} data - the updated item
 * @param {cds.Request} request
 */
module.exports = async function (data, request) {
  LOG.info("--- AFTER UPDATE RequestItems.drafts started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Updated item data:", JSON.stringify(data || {}));

    // 1. Resolve the parent Request ID from the updated item.
    const requestId = await resolveParentRequestId(data, request);
    LOG.info("Resolved parent request_ID:", requestId);

    if (!requestId) {
      LOG.warn("No request_ID found for updated item; skipping recalculation.");
      return;
    }

    // 2. Recalculate the parent amounts only (shared util, no resequence).
    const amounts = await recalcAmountsByType(
      requestId,
      false  // doResequence
    );

    LOG.info(
      "Recalculation completed for request",
      `${requestId}: ${JSON.stringify(amounts)}`,
    );

    LOG.info("--- AFTER UPDATE RequestItems.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-after-update-logic:", error);
    // After-phase failure should not corrupt the update result; log only.
  }
};
