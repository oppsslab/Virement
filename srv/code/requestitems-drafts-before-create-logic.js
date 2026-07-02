const cds = require("@sap/cds");

const LOG = cds.log("requestitems-drafts-before-create-logic");

const SR_NO_PAD_LENGTH = 3;

// =============================================================================
//  HELPERS
// =============================================================================

/**
 * Resolves the parent Request ID from request.data or request.params.
 *
 * @param {cds.Request} request
 * @returns {string|null} the parent request_ID, or null if not found
 */
function resolveParentRequestId(request) {
  return (
    request.data?.request_ID ||
    request.params?.[0]?.request_ID ||
    request.params?.[0]?.ID
  );
}

/**
 * Finds the maximum (numeric) srNo from an array of RequestItems.
 * Used to calculate the next available srNo.
 *
 * @param {Array<object>} items - array of { srNo, ... } objects
 * @returns {number} the maximum srNo as a number, or 0 if no items
 */
function getMaxSrNo(items) {
  let maxSrNo = 0;

  for (const item of items || []) {
    const number = parseInt(item.srNo, 10);
    if (!Number.isNaN(number) && number > maxSrNo) {
      maxSrNo = number;
    }
  }

  return maxSrNo;
}

// =============================================================================
//  MAIN HANDLER
//
//  @Before(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems.drafts")
//
//  Assigns a sequential srNo (001, 002, ...) to new RequestItems if not
//  already provided. Reads existing items for the parent Request and
//  increments the maximum srNo.
//
//  Registered ONLY for the draft entity (edit mode only).
// =============================================================================

/**
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE RequestItems.drafts started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Incoming request.data:", JSON.stringify(request.data || {}));
    LOG.info("Request params:", JSON.stringify(request.params || []));

    request.data = request.data || {};
    const tx = cds.tx(request);

    // 1. Resolve parent Request ID.
    const parentRequestId = resolveParentRequestId(request);
    LOG.info("Resolved parent request_ID:", parentRequestId);

    if (!parentRequestId) {
      LOG.error("Unable to determine parent Request ID.");
      return request.error(400, "Unable to determine parent Request ID.");
    }

    // 2. If srNo already provided, skip generation.
    if (request.data.srNo) {
      LOG.info(
        "srNo already provided, skipping generation:",
        request.data.srNo,
      );
      LOG.info(
        "--- BEFORE CREATE RequestItems.drafts ended (existing srNo) ---",
      );
      return;
    }

    // 3. Read existing items to determine next srNo.
    const existingItems = await tx.run(
      SELECT.from(request.target)
        .columns("srNo")
        .where({ request_ID: parentRequestId }),
    );

    LOG.info("Existing items count:", existingItems?.length);

    const maxSrNo = getMaxSrNo(existingItems);
    const nextSrNo = String(maxSrNo + 1).padStart(SR_NO_PAD_LENGTH, "0");

    // 4. Assign the next srNo.
    request.data.srNo = nextSrNo;

    LOG.info("Assigned srNo:", nextSrNo);
    LOG.info("--- BEFORE CREATE RequestItems.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-before-create-logic:", error);
    request.error(500, "An unexpected error occurred while generating SR No.");
  }
};
