const cds = require("@sap/cds");

const { resolveGLGroup } = require("./utils/gl-grouping-lookup");
const { resolveDepartment } = require("./utils/department-grouping-lookup");
const {
  resolveRegionBranch,
} = require("./utils/region-branch-grouping-lookup");
const {
  resolveFunctionalDepartment,
} = require("./utils/functional-department-grouping-lookup");

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

    // 1a. Auto-populate the read-only GL Group and Functional
    // Department whenever a GL Account is already provided at
    // creation time (e.g. a deep-create/upload payload). Client-
    // provided values are always overwritten - these fields are
    // never user-settable.
    if (request.data.glAccount) {
      request.data.glGroup = await resolveGLGroup(tx, request.data.glAccount);

      request.data.functionalDepartment = await resolveFunctionalDepartment(
        tx,
        request.data.glAccount,
      );

      LOG.info(
        "Auto-populated glGroup/functionalDepartment on create:",
        JSON.stringify({
          glAccount: request.data.glAccount,
          glGroup: request.data.glGroup,
          functionalDepartment: request.data.functionalDepartment,
        }),
      );
    }

    // 1b. Auto-populate the read-only Department, Region, and Branch
    // whenever a Cost Centre is already provided at creation time.
    // Client-provided values are always overwritten - these fields
    // are never user-settable.
    if (request.data.costCentre) {
      request.data.department = await resolveDepartment(
        tx,
        request.data.costCentre,
      );

      const { region, branch } = await resolveRegionBranch(
        tx,
        request.data.costCentre,
      );

      request.data.region = region;
      request.data.branch = branch;

      LOG.info(
        "Auto-populated department/region/branch on create:",
        JSON.stringify({
          costCentre: request.data.costCentre,
          department: request.data.department,
          region,
          branch,
        }),
      );
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
