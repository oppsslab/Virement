// ==================================================================
// File: code/approve-reject-request.js
// ==================================================================

const cds = require("@sap/cds");

const {
  getOpenTaskForWorkflowInstance,
  completeTask,
} = require("./utils/workflow-utils");

const postToS4Module = require("./post-to-s4-logic");
const { performPostToS4, businessError } = postToS4Module;

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("approve-reject-request");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const DECISION_APPROVED = "APPROVED";
const DECISION_REJECTED = "REJECTED";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

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
  return (
    request.params?.[0]?.ID || request.data?.in?.ID || request.data?.ID || null
  );
}

/**
 * Finds the current user's Pending RequestApprovers row for this
 * request, matched by normalized email address.
 *
 * @param {object} tx
 * @param {object} RequestApprovers
 * @param {string} requestId
 * @param {string} userEmail
 * @returns {Promise<object|null>}
 */
async function findMyPendingApproverRow(
  tx,
  RequestApprovers,
  requestId,
  userEmail,
) {
  const rows = await tx.run(
    SELECT.from(RequestApprovers)
      .columns("ID", "emailAddress", "status_code", "level")
      .where({
        request_ID: requestId,
        status_code: REQUEST_STATUS.PENDING_APPROVAL,
      }),
  );

  const normalizedUserEmail = normalizeEmail(userEmail);

  return (
    rows.find(
      (row) => normalizeEmail(row.emailAddress) === normalizedUserEmail,
    ) || null
  );
}

/**
 * Loads the Request row's workflowInstanceId and current status.
 *
 * @param {object} tx
 * @param {object} Requests
 * @param {string} requestId
 * @returns {Promise<object|null>}
 */
async function loadRequestForApproval(tx, Requests, requestId) {
  return tx.run(
    SELECT.one
      .from(Requests)
      .columns("ID", "status_code", "workflowInstanceId")
      .where({ ID: requestId }),
  );
}

/**
 * Performs the shared pre-checks and BPA task lookup common to
 * both approve and reject.
 *
 * @param {cds.Request} request
 * @returns {Promise<{
 *   requestId: string,
 *   requestRow: object,
 *   approverRow: object,
 *   taskId: string,
 * }|null>} null if validation failed (request.error already called)
 */
async function prepareApprovalAction(request) {
  const requestId = resolveRequestId(request);

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");

    return null;
  }

  const tx = cds.tx(request);

  const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  const requestRow = await loadRequestForApproval(tx, Requests, requestId);

  if (!requestRow) {
    request.error(404, `Request ${requestId} was not found.`);

    return null;
  }

  if (requestRow.status_code !== REQUEST_STATUS.PENDING_APPROVAL) {
    request.error(409, "This request is no longer pending approval.");

    return null;
  }

  if (!requestRow.workflowInstanceId) {
    LOG.error(
      "Request has no workflowInstanceId. Cannot locate the " +
        "approval task.",
      JSON.stringify({ requestId }),
    );

    request.error(
      500,
      "This request has no associated approval workflow instance.",
    );

    return null;
  }

  const approverRow = await findMyPendingApproverRow(
    tx,
    RequestApprovers,
    requestId,
    request.user?.id,
  );

  if (!approverRow) {
    LOG.warn(
      "User is not a pending approver for this request.",
      JSON.stringify({ requestId, user: request.user?.id }),
    );

    request.error(
      403,
      "You do not have a pending approval task for this request.",
    );

    return null;
  }

  let openTask;

  try {
    openTask = await getOpenTaskForWorkflowInstance(
      requestRow.workflowInstanceId,
    );
  } catch (error) {
    LOG.error(
      "Failed to look up the open task for this request.",
      JSON.stringify({
        requestId,
        workflowInstanceId: requestRow.workflowInstanceId,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );

    request.error(
      502,
      "Unable to reach the approval workflow to process your decision.",
    );

    return null;
  }

  if (!openTask) {
    LOG.error(
      "No open task instance found for workflow instance.",
      JSON.stringify({
        requestId,
        workflowInstanceId: requestRow.workflowInstanceId,
      }),
    );

    request.error(
      409,
      "No open approval task was found for this request. " +
        "It may have already been actioned.",
    );

    return null;
  }

  const taskId = openTask.id || openTask.taskId;

  if (!taskId) {
    LOG.error(
      "Open task instance has no recognizable ID field.",
      JSON.stringify({ requestId, rawTask: openTask }),
    );

    request.error(
      502,
      "The approval task could not be identified. Please try again.",
    );

    return null;
  }

  return { requestId, requestRow, approverRow, taskId };
}

/* ------------------------------------------------------------------ *
 * Action handlers
 * ------------------------------------------------------------------ */

/**
 * @On("approveRequest")
 *
 * Posts the request to S/4 DIRECTLY (in-process, using
 * performPostToS4), using the logged-in user's email as the
 * approver - since CAP already knows this value with certainty
 * here, avoiding any need to pass it through BPA's Form task
 * (which does not support custom output fields).
 *
 * performPostToS4 also marks every other still-Pending approver at
 * the same level as Completed (superseded), and inserts the
 * corresponding RequestHistory entries.
 *
 * The BPA task is only completed AFTER posting succeeds, so a
 * failed posting leaves the task open for the user to retry,
 * rather than prematurely closing out an approval that didn't
 * actually finish.
 *
 * @param {cds.Request} request
 */
async function approveRequest(request) {
  LOG.info("--- approveRequest started ---");

  const prepared = await prepareApprovalAction(request);

  if (!prepared) {
    return;
  }

  const { requestId, taskId } = prepared;

  const approverEmail = request.user?.id;

  const tx = cds.tx(request);

  try {
    const result = await performPostToS4({
      tx,
      request,
      requestId,
      emailAddress: approverEmail,
    });

    LOG.info(
      "S/4 posting completed successfully.",
      JSON.stringify({ requestId, documentNumbers: result.documentNumbers }),
    );

    /*
     * Commit the DB transaction before calling out to BPA, so the
     * posted state is durable before we tell BPA this task/branch
     * is done.
     */
    await tx.commit();
  } catch (error) {
    const safe = businessError(error);

    LOG.error(
      "S/4 posting failed. Approval task will remain open for retry.",
      JSON.stringify({
        requestId,
        message: error.message,
        status: safe.status,
      }),
    );

    request.error(safe.status, safe.message);

    return;
  }

  try {
    await completeTask({
      taskId,
      decision: DECISION_APPROVED,
    });

    LOG.info(
      "Approval task completed via BPA.",
      JSON.stringify({ requestId, taskId }),
    );
  } catch (error) {
    /*
     * S/4 posting already succeeded and was committed at this
     * point. Failing to close the BPA task is a monitoring/
     * housekeeping issue, not a business failure - log it clearly
     * but do not fail the request, since the actual approval and
     * posting are already durably complete.
     */
    LOG.error(
      "S/4 posting succeeded, but the BPA task could not be " +
        "completed. The workflow instance may remain open. " +
        "Manual intervention may be required in Monitor Workflows.",
      JSON.stringify({
        requestId,
        taskId,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }
}

/**
 * @On("rejectRequest")
 *
 * Marks the acting approver's RequestApprovers row as Rejected,
 * then resolves every other still-Pending approver at the same
 * level (also marked Rejected, since the request is now dead
 * regardless of what they would have decided), finalizes
 * Requests.status_code as Rejected, inserts history entries, then
 * completes the BPA task on the Reject branch.
 *
 * @param {cds.Request} request
 */
async function rejectRequest(request) {
  LOG.info("--- rejectRequest started ---");

  const comment = request.data.comment;

  const prepared = await prepareApprovalAction(request);

  if (!prepared) {
    return;
  }

  const { requestId, approverRow, taskId } = prepared;

  const approverEmail = request.user?.id;

  const tx = cds.tx(request);

  const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  try {
    await tx.run(
      UPDATE(RequestApprovers)
        .set({
          status_code: REQUEST_STATUS.REJECTED,
          actionDate: new Date().toISOString(),
          comment: comment || null,
        })
        .where({ ID: approverRow.ID }),
    );

    await tx.run(
      UPDATE(Requests)
        .set({
          status_code: REQUEST_STATUS.REJECTED,
          approverComment: comment || null,
        })
        .where({ ID: requestId }),
    );

    await insertRequestHistory(
      request,
      requestId,
      `Rejected by ${approverEmail}.${comment ? ` Comment: ${comment}` : ""}`,
    );

    /*
     * Resolve every other still-Pending approver at the same
     * level, since a single rejection ends the whole request
     * regardless of what they would have decided.
     */
    const siblingRows = await tx.run(
      SELECT.from(RequestApprovers).columns("ID", "emailAddress").where({
        request_ID: requestId,
        level: approverRow.level,
        status_code: REQUEST_STATUS.PENDING_APPROVAL,
      }),
    );

    if (siblingRows.length > 0) {
      const siblingIds = siblingRows.map((row) => row.ID);

      await tx.run(
        UPDATE(RequestApprovers)
          .set({
            status_code: REQUEST_STATUS.REJECTED,
            comment: `Not required to act - request already rejected by ${approverEmail}.`,
          })
          .where({ ID: { in: siblingIds } }),
      );

      const siblingEmails = siblingRows
        .map((row) => row.emailAddress)
        .join(", ");

      await insertRequestHistory(
        request,
        requestId,
        `${siblingEmails} were not required to act - request already rejected by ${approverEmail}.`,
      );

      LOG.info(
        "Other Level pending approvers auto-resolved (rejected):",
        JSON.stringify({ requestId, siblingEmails }),
      );
    }

    await tx.commit();

    LOG.info("Request rejected.", JSON.stringify({ requestId, approverEmail }));
  } catch (error) {
    LOG.error(
      "Failed to record rejection.",
      JSON.stringify({ requestId, message: error.message }),
    );

    request.error(500, "Unable to reject this request. Please try again.");

    return;
  }

  try {
    await completeTask({
      taskId,
      decision: DECISION_REJECTED,
      comment,
    });

    LOG.info(
      "Rejection task completed via BPA.",
      JSON.stringify({ requestId, taskId }),
    );
  } catch (error) {
    LOG.error(
      "Rejection was recorded, but the BPA task could not be " +
        "completed. The workflow instance may remain open. " +
        "Manual intervention may be required in Monitor Workflows.",
      JSON.stringify({
        requestId,
        taskId,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }
}

module.exports = { approveRequest, rejectRequest };
