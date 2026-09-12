const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS } = require("./utils/request-status");

const {
  findOpenTasksForLevels,
  addTaskRecipient,
} = require("./utils/workflow-utils");

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
 * someone else. Every RequestApprovers row still Pending Approval for
 * the current user on this request has its emailAddress swapped to
 * the delegate, keeping the same level and status - the delegate then
 * passes the same "is this user a pending approver" check the
 * existing Approve/Reject actions already use.
 *
 * The current user is also swapped out for the delegate as a
 * recipient on the matching SAP Build Process Automation task(s) (see
 * addTaskRecipient in utils/workflow-utils.js) so BPA's own My Inbox
 * follows the same delegation - any OTHER recipient already on the
 * task (e.g. a different approver at the same level) is left as-is,
 * only the delegating user is removed - best-effort: this app's own
 * delegation above is the source of truth and already committed by
 * the time that call happens, so a BPA-side failure (e.g. missing
 * ProcessAutomationAdmin privilege) is logged only, never surfaced to
 * the caller as a failure of the delegation they just performed.
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
      .columns("ID", "status_code", "workflowInstanceId")
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
      .columns("ID", "emailAddress", "level")
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

  /*
   * Best-effort: this app's own delegation already committed above,
   * so a BPA-side failure here must not fail the delegation the user
   * just successfully performed. Logged only, same treatment as
   * completeTask's callers give a BPA failure.
   */
  try {
    const tasks = await findOpenTasksForLevels(
      requestRow.workflowInstanceId,
      myPendingRows.map((row) => row.level),
    );

    await Promise.all(
      tasks.map((task) =>
        addTaskRecipient({
          taskId: task.id || task.taskId,
          existingRecipients: task.recipientUsers,
          removeRecipientEmail: approverEmail,
          recipientEmail: delegateEmail,
        }),
      ),
    );

    LOG.info(
      "BPA task recipient swapped to delegate.",
      JSON.stringify({
        requestId,
        taskIds: tasks.map((t) => t.id || t.taskId),
        from: approverEmail,
        to: delegateEmail,
      }),
    );
  } catch (error) {
    LOG.error(
      "Could not add the delegate as a BPA task recipient for this " +
        "delegation - this app's own record is still correctly delegated.",
      JSON.stringify({
        requestId,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }

  request.info(`Approval delegated to ${delegateEmail}.`);
};
