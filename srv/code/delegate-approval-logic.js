const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("delegate-approval-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Resolves the Request ID from the bound action's entity context.
 *
 * @param {cds.Request} request
 * @returns {string|null}
 */
function resolveRequestId(request) {
  return request.params?.[0]?.ID || request.data?.ID || null;
}

/**
 * @On("delegateApproval")
 *
 * Lets the current pending approver hand off their approval task to
 * someone else, without involving SAP Build Process Automation at
 * all. Every RequestApprovers row still Pending Approval for the
 * current user on this request has its emailAddress swapped to the
 * delegate, keeping the same level and status - the delegate then
 * passes the same "is this user a pending approver" check the
 * existing Approve/Reject actions already use.
 *
 * The BPA task itself is left untouched: it stays assigned to
 * whoever/whatever BPA originally recorded, since nothing here
 * calls out to BPA. Only this app's own record of who may act is
 * updated.
 *
 * @param {cds.Request} request
 */
module.exports = async function delegateApproval(request) {
  LOG.info("--- delegateApproval started ---");

  const requestId = resolveRequestId(request);

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");
    return;
  }

  const delegateEmail = normalizeEmail(request.data?.delegateEmail);
  const approverEmail = normalizeEmail(request.user?.id);

  if (!delegateEmail) {
    request.error(400, "Delegate To is required.");
    return;
  }

  if (!EMAIL_PATTERN.test(delegateEmail)) {
    request.error(400, "Delegate To must be a valid email address.");
    return;
  }

  if (delegateEmail === approverEmail) {
    request.error(400, "You cannot delegate an approval to yourself.");
    return;
  }

  const tx = cds.tx(request);

  const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  const requestRow = await tx.run(
    SELECT.one
      .from(Requests)
      .columns("ID", "status_code")
      .where({ ID: requestId }),
  );

  if (!requestRow) {
    request.error(404, `Request ${requestId} was not found.`);
    return;
  }

  if (requestRow.status_code !== REQUEST_STATUS.PENDING_APPROVAL) {
    request.error(409, "This request is no longer pending approval.");
    return;
  }

  const pendingRows = await tx.run(
    SELECT.from(RequestApprovers)
      .columns("ID", "emailAddress")
      .where({
        request_ID: requestId,
        status_code: REQUEST_STATUS.PENDING_APPROVAL,
      }),
  );

  const myPendingRows = pendingRows.filter(
    (row) => normalizeEmail(row.emailAddress) === approverEmail,
  );

  if (!myPendingRows.length) {
    LOG.warn(
      "User is not a pending approver for this request.",
      JSON.stringify({ requestId, user: approverEmail }),
    );

    request.error(
      403,
      "You do not have a pending approval task for this request.",
    );
    return;
  }

  await tx.run(
    UPDATE(RequestApprovers)
      .set({ emailAddress: delegateEmail })
      .where({ ID: { in: myPendingRows.map((row) => row.ID) } }),
  );

  await insertRequestHistory(
    request,
    requestId,
    `${approverEmail} delegated this approval to ${delegateEmail}.`,
  );

  await tx.commit();

  LOG.info(
    "Approval delegated.",
    JSON.stringify({ requestId, from: approverEmail, to: delegateEmail }),
  );

  request.info(`Approval delegated to ${delegateEmail}.`);
};
