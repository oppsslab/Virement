// ==================================================================
// File: code/approve-reject-request.js
// ==================================================================

const cds = require("@sap/cds");

const {
  getOpenTaskForWorkflowInstance,
  hasCompletedTaskForWorkflowInstance,
  completeTask,
} = require("./utils/workflow-utils");

const postToS4Module = require("./post-to-s4-logic");
const { performPostToS4, businessError } = postToS4Module;

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("approve-reject-request");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const DECISION_APPROVED = "approve";
const DECISION_REJECTED = "reject";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function getLevelNumber(level) {
  // Extract digits from the string
  const match = level.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
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
  
  const lastApprover = await tx.run(
    SELECT.one.from(RequestApprovers)
      .columns("ID", "emailAddress", "status_code", "level")
      .where({
        request_ID: requestId
      })
      .orderBy('level desc')
  );

  const normalizedUserEmail = normalizeEmail(userEmail);

  let approverRow = rows.filter(
      (row) => normalizeEmail(row.emailAddress) === normalizedUserEmail,
    ) || [];

  return { approverRow, rows, lastApprover };
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
      .columns("ID", "status_code", "workflowInstanceId", "currentApprovalLevel")
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
  // const requestId = "b1f49e45-3387-47f3-9c04-a5643d12ce6c";

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");

    return null;
  }

  const approverEmail = request.user?.id;
  // const approverEmail = "willy.angkasa@pwc.com";

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

  const { approverRow, rows, lastApprover } = await findMyPendingApproverRow(
    tx,
    RequestApprovers,
    requestId,
    approverEmail,
  );

  if (!approverRow.length) {
    LOG.warn(
      "User is not a pending approver for this request.",
      JSON.stringify({ requestId, user: approverEmail }),
    );

    request.error(
      403,
      "You do not have a pending approval task for this request.",
    );

    return null;
  }

  let openTask = [];

  try {
    openTask = await getOpenTaskForWorkflowInstance(
      requestRow.workflowInstanceId,
    );
    console.log(openTask);
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

  if (!openTask.length) {
    /*
     * No open task doesn't necessarily mean nothing is left to do
     * here. If BPA shows the task as COMPLETED, it was actioned
     * directly in BPA's My Inbox rather than through this app - most
     * often because this app's own flow errored partway through
     * (e.g. an S/4 posting rejection) and the user worked around it
     * there. This app's RequestApprovers/Requests rows are then left
     * stuck Pending with no task left to complete. Rather than
     * dead-ending on "already actioned", let the caller resync its
     * own records: taskIds stays empty, so no BPA call is attempted
     * again.
     */
    let completedExternally = false;

    try {
      completedExternally = await hasCompletedTaskForWorkflowInstance(
        requestRow.workflowInstanceId,
      );
    } catch (error) {
      LOG.error(
        "Failed to check for a completed task instance.",
        JSON.stringify({
          requestId,
          workflowInstanceId: requestRow.workflowInstanceId,
          message: error.message,
        }),
      );
    }

    if (completedExternally) {
      LOG.warn(
        "No open task, but a completed one exists for this workflow " +
          "instance - it was actioned outside this app. Resyncing " +
          "local records only.",
        JSON.stringify({
          requestId,
          workflowInstanceId: requestRow.workflowInstanceId,
        }),
      );

      return {
        requestId,
        requestRow,
        approverRow,
        rows,
        lastApprover,
        taskIds: [],
        syncOnly: true,
      };
    }

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

  /*
   * Matching a task to this approver's level.
   *
   * With only one open task for this workflow instance there is
   * nothing to disambiguate: findMyPendingApproverRow already
   * confirmed a Pending Approval row for this user on this request,
   * and getOpenTaskForWorkflowInstance already scoped the tasks to
   * this exact request's workflow instance, so that task is the one
   * to act on regardless of its subject text. Requiring the subject
   * to also spell out the level broke a real approval: BPA's subject
   * text carries only the numeric level ("Pending L1 Approval ..."),
   * never the level value stored on RequestApprovers ("2A"), so the
   * two could never match here.
   *
   * With more than one open task - parallel levels genuinely pending
   * at once - the numeric level is matched against an "L<number>"
   * token, which is the format BPA's subject text actually uses.
   */
  let filterTask = openTask;

  if (openTask.length > 1) {
    const levelTokens = approverRow
      .map((x) => `L${getLevelNumber(x.level)}`)
      .filter((token) => token !== "Lnull");

    filterTask = openTask.filter(function (task) {
      const subject = String(task?.subject || "");
      return levelTokens.some((token) => subject.includes(token));
    });
  }

  const taskIds = filterTask.map(x => x.id || x.taskId);

  if (!taskIds.length) {
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

  return { requestId, requestRow, approverRow, rows, lastApprover, taskIds };
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

  const { requestId, taskIds, approverRow, rows, lastApprover, requestRow, syncOnly } = prepared;
  console.log(prepared)

  const approverEmail = request.user?.id;
  // const approverEmail = "willy.angkasa@pwc.com";

  const currentLevel = requestRow.currentApprovalLevel; // 1
  console.log("currentLevel:", currentLevel)

  const remainingPendingApproval = rows.filter(x => !approverRow.map(r => r.level).includes(x.level));

  const lastLevel = getLevelNumber(lastApprover.level); // 2
  console.log("lastLevel:", lastLevel)

  let nextLevel = Math.min(currentLevel + 1, lastLevel);
  console.log("nextLevel:", nextLevel)

  // Stop Update
  let remainingParallelApproval = false; 
  if ( currentLevel === 2 && remainingPendingApproval.length > 0) {
    nextLevel = 2;
    remainingParallelApproval = true;
  }
  
  const tx = cds.tx(request);

  const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  // Approve for User
  await tx.run(
    UPDATE(RequestApprovers)
      .set({
        status_code: REQUEST_STATUS.APPROVED,
        actionDate: new Date().toISOString()
      })
      .where({ ID: { in: approverRow.map(x => x.ID) } }),
  );

  if ( currentLevel !== nextLevel ) {
    // Pending Next Approver
    await tx.run(
      UPDATE(RequestApprovers)
        .set({
          status_code: REQUEST_STATUS.PENDING_APPROVAL
        })
      .where({ level: { like: `${nextLevel}%` } })   // contains "A"
    );
  }

  let newStatusCode = REQUEST_STATUS.PENDING_APPROVAL;
  // Skip Update if there is remaining parallel approval
  if (!remainingParallelApproval){
    // Update Request
    newStatusCode = currentLevel === lastLevel ? REQUEST_STATUS.APPROVED : REQUEST_STATUS.PENDING_APPROVAL;
    await tx.run(
      UPDATE(Requests)
        .set({
          status_code: newStatusCode,
          currentApprovalLevel: nextLevel 
        })
        .where({ ID: requestId })
    );
  }

  /*
    * Resolve every other still-Pending approver at the same
    * level, since a single rejection ends the whole request
    * regardless of what they would have decided.
    */
  const siblingRows = await tx.run(
    SELECT.from(RequestApprovers).columns("ID", "emailAddress").where({
      request_ID: requestId,
      level: { in: approverRow.map(x => x.level) },
      status_code: REQUEST_STATUS.PENDING_APPROVAL,
    }),
  );

  if (siblingRows.length > 0) {
    const siblingIds = siblingRows.map((row) => row.ID);

    await tx.run(
      UPDATE(RequestApprovers)
        .set({
          status_code: REQUEST_STATUS.APPROVED,
          comment: `Not required to act - request already approved by ${approverEmail}.`,
        })
        .where({ ID: { in: siblingIds } }),
    );

    const siblingEmails = siblingRows
      .map((row) => row.emailAddress)
      .join(", ");

    await insertRequestHistory(
      request,
      requestId,
      `${siblingEmails} were not required to act - request approved rejected by ${approverEmail}.`,
    );

    LOG.info(
      "Other Level pending approvers auto-resolved (rejected):",
      JSON.stringify({ requestId, siblingEmails }),
    );
  }

  if (syncOnly) {
    /*
     * The BPA task was already completed outside this app, so there
     * is no task left to complete and - per how this request was
     * resolved - no S/4 posting is attempted here either. Only the
     * local bookkeeping (already updated above) is synced to match
     * BPA. This is recorded explicitly so it is never mistaken for a
     * normal, fully-posted approval.
     */
    await insertRequestHistory(
      request,
      requestId,
      `Approval status synced by ${approverEmail}: the BPA task was ` +
        "already completed outside this app. No S/4 posting was " +
        "attempted as part of this sync.",
    );

    await tx.commit();

    LOG.warn(
      "Synced local approval status without an S/4 posting " +
        "(BPA task was already completed externally).",
      JSON.stringify({ requestId, approverEmail }),
    );

    request.info(
      "Approval status has been synced to match the workflow, which " +
        "was already completed. No S/4 posting was attempted.",
    );

    return;
  }

  if (newStatusCode === REQUEST_STATUS.APPROVED){
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
      console.log(error)
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
  }

  try {
    for (const taskId of taskIds) {
      await completeTask({
        taskId,
        decision: DECISION_APPROVED,
      });
    }

    LOG.info(
      "Approval task completed via BPA.",
      JSON.stringify({ requestId, taskIds }),
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
        taskIds,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }
  request.info('Request Approved successfully');
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

  const { requestId, approverRow, row, lastApprover, taskIds } = prepared;

  const approverEmail = request.user?.id;
  // const approverEmail = "willy.angkasa@pwc.com";

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
        .where({ ID: { in: approverRow.map(x => x.ID) } }),
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
    const approverLevel = getLevelNumber(approverRow[0].level); // 2
    const siblingRows = await tx.run(
      SELECT.from(RequestApprovers).columns("ID", "emailAddress").where({
        request_ID: requestId,
        level: { like: `${approverLevel}%` },  // contains "A"
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
    for (const taskId of taskIds) {
      await completeTask({
        taskId,
        decision: DECISION_REJECTED,
      });
    }

    LOG.info(
      "Rejection task completed via BPA.",
      JSON.stringify({ requestId, taskIds }),
    );
  } catch (error) {
    LOG.error(
      "Rejection was recorded, but the BPA task could not be " +
        "completed. The workflow instance may remain open. " +
        "Manual intervention may be required in Monitor Workflows.",
      JSON.stringify({
        requestId,
        taskIds,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );
  }
  request.info('Request Rejected successfully');
}

module.exports = { approveRequest, rejectRequest };
