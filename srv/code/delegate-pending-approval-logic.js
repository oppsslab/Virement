const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const {
  findOpenTasksForLevels,
  addTaskRecipient,
} = require("./utils/workflow-utils");

const LOG = cds.log("delegate-pending-approval-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Resolves the RequestApprovers row ID from the bound action's entity
 * context.
 *
 * This action is invoked via a deep path -
 * ApproverMatrix(ID=...)/PendingApprovals(ID=...)/delegatePendingApproval
 * - so request.params holds ONE entry PER path segment: params[0] is
 * the ApproverMatrix (grandparent) key, params[1] is the actual bound
 * RequestApprovers row's key. Confirmed live via server logs: reading
 * params[0] was sending the ApproverMatrix's own ID to the lookup
 * below, which (being a different entity's ID) predictably never
 * matched any RequestApprovers row - the "Approval assignment ...
 * was not found" error this produced was misdiagnosed several times
 * as stale/resubmitted data before this was found. The bound
 * entity's own key is always the LAST segment, regardless of how
 * deep the path is.
 *
 * @param {cds.Request} request
 * @returns {string|null}
 */
function resolveApproverRowId(request) {
  const params = request.params || [];

  return params[params.length - 1]?.ID || request.data?.ID || null;
}

/**
 * @On("delegatePendingApproval")
 *
 * Admin-triggered counterpart to delegateApproval (see
 * delegate-approval-logic.js) - lets an ADMIN user reassign a
 * SPECIFIC pending RequestApprovers row to someone else, from the
 * Approver Matrix Object Page's Pending Approvals facet, without the
 * admin needing to be the current pending approver themselves.
 *
 * Bound to RequestApprovers (not Requests) so each call targets
 * exactly one pending assignment - the one the admin selected in the
 * table - rather than every pending row that shares that email
 * address on the request.
 *
 * Same scope as delegateApproval, including best-effort swapping the
 * original approver out for the delegate as a BPA task recipient (see
 * addTaskRecipient in utils/workflow-utils.js) - any OTHER recipient
 * already on the task is left as-is - this app's own record above is
 * the source of truth and already committed by the time that call
 * happens, so a BPA-side failure is logged only, never surfaced as a
 * failure of the delegation the admin just performed.
 *
 * @param {cds.Request} request
 */
module.exports = async function delegatePendingApproval(request) {
  LOG.info("--- delegatePendingApproval started ---");

  const approverRowId = resolveApproverRowId(request);

  if (!approverRowId) {
    request.error(400, "Unable to determine the approval assignment to act on.");
    return;
  }

  const delegateEmail = normalizeEmail(request.data?.delegateEmail);

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

  const approverRow = await tx.run(
    SELECT.one
      .from(RequestApprovers)
      .columns("ID", "request_ID", "emailAddress", "status_code", "level")
      .where({ ID: approverRowId }),
  );

  if (!approverRow) {
    request.error(404, `Approval assignment ${approverRowId} was not found.`);
    return;
  }

  if (approverRow.status_code !== APPROVER_STATUS.PENDING_APPROVAL) {
    request.error(409, "This approval assignment is no longer pending.");
    return;
  }

  if (normalizeEmail(approverRow.emailAddress) === delegateEmail) {
    request.error(400, "This request is already assigned to that person.");
    return;
  }

  const requestRow = await tx.run(
    SELECT.one
      .from(Requests)
      .columns("ID", "status_code", "workflowInstanceId")
      .where({ ID: approverRow.request_ID }),
  );

  if (!requestRow || requestRow.status_code !== REQUEST_STATUS.PENDING_APPROVAL) {
    request.error(409, "This request is no longer pending approval.");
    return;
  }

  await tx.run(
    UPDATE(RequestApprovers)
      .set({ emailAddress: delegateEmail })
      .where({ ID: approverRowId }),
  );

  await insertRequestHistory(
    request,
    approverRow.request_ID,
    `${request.user?.id || "An admin"} delegated ${approverRow.emailAddress}'s ${approverRow.level} approval to ${delegateEmail}.`,
  );

  await tx.commit();

  LOG.info(
    "Pending approval delegated by admin.",
    JSON.stringify({
      approverRowId,
      requestId: approverRow.request_ID,
      from: approverRow.emailAddress,
      to: delegateEmail,
    }),
  );

  /*
   * Best-effort: this app's own delegation already committed above,
   * so a BPA-side failure here (e.g. missing ProcessAutomationAdmin
   * privilege - see addTaskRecipient's doc comment) must not fail the
   * action the admin just successfully performed. Logged only, same
   * treatment as completeTask's callers give a BPA failure.
   */
  try {
    const tasks = await findOpenTasksForLevels(
      requestRow.workflowInstanceId,
      [approverRow.level],
    );

    await Promise.all(
      tasks.map((task) =>
        addTaskRecipient({
          taskId: task.id || task.taskId,
          existingRecipients: task.recipientUsers,
          removeRecipientEmail: approverRow.emailAddress,
          recipientEmail: delegateEmail,
        }),
      ),
    );

    LOG.info(
      "BPA task recipient swapped to delegate by admin.",
      JSON.stringify({
        approverRowId,
        taskIds: tasks.map((t) => t.id || t.taskId),
        from: approverRow.emailAddress,
        to: delegateEmail,
      }),
    );
  } catch (error) {
    LOG.error(
      "Could not reassign the BPA task for this admin delegation - " +
        "this app's own record is still correctly delegated.",
      JSON.stringify({
        approverRowId,
        requestId: approverRow.request_ID,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }

  request.info(`Delegated to ${delegateEmail}.`);
};
