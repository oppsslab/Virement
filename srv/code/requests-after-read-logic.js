const cds = require("@sap/cds");
const { ROLES } = require("./utils/roles");

const LOG = cds.log("requests-after-read-logic");

/**
 * Determines whether the given user is allowed to approve a request.
 *
 * Rules (ALL must be true):
 *   1. User holds the REQUEST_APPROVE role.
 *   2. User is NOT the creator/requestor (separation of duties —
 *      no self-approval).
 *
 * @param {object} user - request.user
 * @param {object} row - a single Request record
 * @returns {boolean}
 */
function canUserApprove(user, row) {
  if (!user || !row) {
    return false;
  }

  const hasRole = user.is(ROLES.REQUEST_APPROVE) === true;
  if (!hasRole) {
    return false;
  }

  const userId = user.id;

  // Block self-approval: user must not be the requestor or the creator.
  const isRequestor = !!row.requestor && row.requestor === userId;
  const isCreator = !!row.createdBy && row.createdBy === userId;

  if (isRequestor || isCreator) {
    return false;
  }

  return true;
}

/**
 * @After(event = { "READ" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 *
 * Computes the virtual `hideApprovalBtn` flag per row:
 *   hideApprovalBtn = NOT(canUserApprove)
 *
 * The Approve/Reject buttons are hidden unless the user holds the
 * REQUEST_APPROVE role AND is not the creator of that request.
 *
 * @param {(Object|Object[])} results
 * @param {cds.Request} request
 */
module.exports = async function (results, request) {
  try {
    const user = request.user;
    const hasRole = user?.is(ROLES.REQUEST_APPROVE) === true;

    LOG.info("User:", user?.id);
    LOG.info("Has REQUEST_APPROVE role:", hasRole);

    const list = Array.isArray(results) ? results : [results];

    for (const row of list) {
      if (!row) {
        continue;
      }

      const allowed = canUserApprove(user, row);
      row.hideApprovalBtn = !allowed;

      LOG.info(
        `Request ${row.ID || row.requestNumber || "?"}: ` +
          `requestor=${row.requestor}, createdBy=${row.createdBy}, ` +
          `allowed=${allowed}, hideApprovalBtn=${row.hideApprovalBtn}`,
      );
    }
  } catch (error) {
    // Fail-safe: hide buttons on any error (secure default).
    LOG.error("Error computing hideApprovalBtn (defaulting to hidden):", error);

    const list = Array.isArray(results) ? results : [results];
    for (const row of list) {
      if (row) {
        row.hideApprovalBtn = true;
      }
    }
  }
};
