const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const {
  findOpenTasksForLevels,
  addTaskRecipient,
} = require("./utils/workflow-utils");

const LOG = cds.log("delegate-approval-as-admin-logic");

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
 * @On("delegateApprovalAsAdmin")
 *
 * Admin-only counterpart to delegateApproval (see
 * delegate-approval-logic.js), exposed as a Delegate button on the
 * Requests Object Page itself - unlike delegateApproval (which only
 * the current pending approver can invoke on their own request) or
 * delegatePendingApproval (which targets one specific RequestApprovers
 * row from the Approver Matrix), this lets an ADMIN delegate every
 * currently-pending approval on THIS request in one action, without
 * being an approver themselves and without needing to know which row
 * on the Approver Matrix corresponds to it.
 *
 * Every RequestApprovers row still Pending Approval on this request -
 * whichever approver(s) are currently blocking it - has its
 * emailAddress swapped to the delegate.
 *
 * The matching SAP Build Process Automation task(s) also have each
 * original approver swapped out for the delegate (see addTaskRecipient
 * in utils/workflow-utils.js), one swap per delegated row's level -
 * best-effort: this app's own delegation above is the source of truth
 * and already committed by the time that call happens, so a BPA-side
 * failure is logged only, never surfaced to the caller as a failure of
 * the delegation they just performed.
 *
 * @param {cds.Request} request
 */
module.exports = async function delegateApprovalAsAdmin(request) {
  LOG.info("--- delegateApprovalAsAdmin started ---");

  const requestId = resolveRequestId(request);

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");
    return;
  }

  const delegateEmail = normalizeEmail(request.data?.delegateEmail);
  const adminEmail = normalizeEmail(request.user?.id);

  if (!delegateEmail) {
    request.error(400, "Delegate To is required.");
    return;
  }

  if (!EMAIL_PATTERN.test(delegateEmail)) {
    request.error(400, "Delegate To must be a valid email address.");
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
        status_code: APPROVER_STATUS.PENDING_APPROVAL,
      }),
  );

  if (!pendingRows.length) {
    request.error(
      409,
      "This request has no pending approval to delegate.",
    );
    return;
  }

  const rowsToDelegate = pendingRows.filter(
    (row) => normalizeEmail(row.emailAddress) !== delegateEmail,
  );

  if (!rowsToDelegate.length) {
    request.error(400, "This request is already assigned to that person.");
    return;
  }

  await tx.run(
    UPDATE(RequestApprovers)
      .set({ emailAddress: delegateEmail })
      .where({ ID: { in: rowsToDelegate.map((row) => row.ID) } }),
  );

  await insertRequestHistory(
    request,
    requestId,
    `${request.user?.id || "An admin"} delegated this request's pending approval(s) to ${delegateEmail}.`,
  );

  await tx.commit();

  LOG.info(
    "Approval(s) delegated by admin.",
    JSON.stringify({
      requestId,
      from: rowsToDelegate.map((row) => row.emailAddress),
      to: delegateEmail,
    }),
  );

  /*
   * Best-effort: this app's own delegation already committed above,
   * so a BPA-side failure here must not fail the delegation the admin
   * just successfully performed. Logged only, same treatment as
   * completeTask's callers give a BPA failure.
   */
  try {
    await Promise.all(
      rowsToDelegate.map(async (row) => {
        const tasks = await findOpenTasksForLevels(
          requestRow.workflowInstanceId,
          [row.level],
        );

        await Promise.all(
          tasks.map((task) =>
            addTaskRecipient({
              taskId: task.id || task.taskId,
              existingRecipients: task.recipientUsers,
              removeRecipientEmail: row.emailAddress,
              recipientEmail: delegateEmail,
            }),
          ),
        );
      }),
    );

    LOG.info(
      "BPA task recipient(s) swapped to delegate by admin.",
      JSON.stringify({ requestId, to: delegateEmail }),
    );
  } catch (error) {
    LOG.error(
      "Could not swap the BPA task recipient for this admin delegation - " +
        "this app's own record is still correctly delegated.",
      JSON.stringify({
        requestId,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }

  request.info(`Delegated to ${delegateEmail}.`);
};
