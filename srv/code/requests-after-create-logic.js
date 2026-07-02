const cds = require("@sap/cds");
const insertRequestHistory = require("./insert-request-history");
const { HISTORY_MESSAGES } = require("./utils/history-messages");

const LOG = cds.log("requests-after-create-logic");

// =============================================================================
//  HELPERS
// =============================================================================

/**
 * Resolves the Request ID from the created result or request.data.
 * Handles both single object and array results.
 *
 * @param {Object|Object[]} results - the created record(s)
 * @param {cds.Request} request - the CAP request
 * @returns {string|null} the Request ID, or null if not found
 */
function resolveRequestId(results, request) {
  const result = Array.isArray(results) ? results[0] : results;
  return result?.ID || request.data?.ID || null;
}

// =============================================================================
//  MAIN HANDLER
//
//  @After(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests")
//
//  After a new Request record is created (active entity), inserts a history
//  entry marking the request as SUBMITTED. This tracks the creation timestamp
//  and user.
//
//  Registered on the active (non-draft) Requests entity.
// =============================================================================

/**
 * @param {Object|Object[]} results - the created request record(s)
 * @param {cds.Request} request - the CAP request context
 */
module.exports = async function (results, request) {
  LOG.info("--- AFTER CREATE Requests started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Results:", JSON.stringify(results || {}));

    // 1. Resolve the created Request ID.
    const requestId = resolveRequestId(results, request);
    LOG.info("Resolved Request ID for history:", requestId);

    if (!requestId) {
      LOG.warn("No Request ID found. Skipping history insert.");
      return;
    }

    // 2. Insert a SUBMITTED history entry.
    const inserted = await insertRequestHistory(
      request,
      requestId,
      HISTORY_MESSAGES.SUBMITTED,
    );

    LOG.info("RequestHistory inserted:", inserted);
    LOG.info("--- AFTER CREATE Requests ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-after-create-logic (non-fatal):", error);
    // After-phase failure should not corrupt the create result; log only.
  }
};
