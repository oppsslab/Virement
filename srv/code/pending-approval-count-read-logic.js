const cds = require("@sap/cds");

const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const LOG = cds.log("pending-approval-count-read-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Normalizes an email address for comparison.
 *
 * Stored approver emails are not guaranteed to match the
 * authenticated user's casing / padding.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Counts the requests that are waiting for the current user's
 * approval.
 *
 * A request is counted when BOTH are true:
 *   1. The request itself is Pending Approval.
 *   2. The current user has a Pending Approval RequestApprovers
 *      row on it (i.e. it is sitting at their level right now).
 *
 * Returns data for custom entity:
 *   PendingApprovalCount {
 *     pendingCount
 *   }
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<Array<Object>>}
 */
module.exports = async function readPendingApprovalCount(request) {
  LOG.info("--- READ PendingApprovalCount started ---");

  try {
    const tx = cds.tx(request);
    const serviceEntities = cds.entities(SERVICE_NAMESPACE);

    if (!serviceEntities || !serviceEntities.Requests) {
      LOG.error("Requests entity not found in namespace:", SERVICE_NAMESPACE);

      return request.error(
        500,
        "Internal configuration error: Requests entity not found."
      );
    }

    const { Requests, RequestApprovers } = serviceEntities;

    const userEmail = normalizeEmail(request.user && request.user.id);

    if (!userEmail) {
      LOG.warn("No user ID found. Returning a pending count of 0.");

      return [{ pendingCount: 0 }];
    }

    LOG.info("Counting pending approvals for user:", userEmail);

    /*
     * Read every approver row that is still awaiting a decision,
     * then match the current user in JS so the comparison stays
     * case-insensitive.
     */
    const approverRows = await tx.run(
      SELECT.from(RequestApprovers)
        .columns("request_ID", "emailAddress")
        .where({ status_code: APPROVER_STATUS.PENDING_APPROVAL })
    );

    const myRequestIds = [
      ...new Set(
        (approverRows || [])
          .filter(function (row) {
            return normalizeEmail(row.emailAddress) === userEmail;
          })
          .map(function (row) {
            return row.request_ID;
          })
          .filter(Boolean)
      ),
    ];

    if (myRequestIds.length === 0) {
      LOG.info("No approver rows assigned to the user.");
      LOG.info("--- READ PendingApprovalCount ended successfully ---");

      return [{ pendingCount: 0 }];
    }

    /*
     * Keep only the requests that are themselves still Pending
     * Approval, so withdrawn / already completed requests with a
     * stale approver row are not counted.
     */
    const rows = await tx.run(
      SELECT.from(Requests)
        .columns("ID")
        .where({
          ID: { in: myRequestIds },
          status_code: REQUEST_STATUS.PENDING_APPROVAL,
        })
    );

    const pendingCount = rows ? rows.length : 0;

    LOG.info("Pending approval count:", pendingCount);
    LOG.info("--- READ PendingApprovalCount ended successfully ---");

    return [{ pendingCount }];
  } catch (error) {
    LOG.error("Error in pending-approval-count-read-logic:", error);

    return request.error(500, "Could not read the pending approval count.");
  }
};
