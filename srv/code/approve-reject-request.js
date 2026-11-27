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

const {
  completeEarmarkedFundsDocument,
  getEarmarkedFundsDocumentStatus,
} = require("./utils/earmarked-funds");

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS } = require("./utils/request-status");

const { loadEmailContext } = require("./utils/approval-email-context");

const {
  completeEarmarkedFundsAfterRejection,
} = require("./utils/earmarked-funds-rejection");

const {
  renderEmailConfig,
  EMAIL_TYPE,
} = require("./utils/email-config-renderer");

const { sendEmail } = require("./utils/send-email");

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
      .columns(
        "ID",
        "status_code",
        "workflowInstanceId",
        "currentApprovalLevel",
        "requestType_code",
        "earmarkedFundsDocNumber",
        "transferOutDocNumber",
        "requestor",
      )
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

  const approverEmail = normalizeEmail(request.user?.id);
  
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

  const found = await findMyPendingApproverRow(
    tx,
    RequestApprovers,
    requestId,
    approverEmail,
  );

  const { rows, lastApprover } = found;

  /*
   * Only an approver at the request's CURRENT level may act. The
   * current level is the lowest level that still has a Pending
   * approver, not the stored currentApprovalLevel: an earlier bug
   * could leave a request's stored level behind its approver rows
   * (every Level 1 row Completed, Level 2 Pending, stored level
   * still 1), which would otherwise lock out the real next approver.
   * The stored level is corrected in memory so the rest of the
   * approve flow (final-level check, next level) works from it too.
   */
  const pendingLevelNumbers = rows
    .map((row) => getLevelNumber(row.level))
    .filter((levelNumber) => Number.isFinite(levelNumber));

  const currentLevelNumber = pendingLevelNumbers.length
    ? Math.min(...pendingLevelNumbers)
    : Number(requestRow.currentApprovalLevel);

  if (Number.isFinite(currentLevelNumber)) {
    requestRow.currentApprovalLevel = currentLevelNumber;
  }

  const approverRow = Number.isFinite(currentLevelNumber)
    ? found.approverRow.filter(
        (row) => getLevelNumber(row.level) === currentLevelNumber,
      )
    : found.approverRow;

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
    /*
     * getOpenTaskForWorkflowInstance returns null (not []) when it
     * finds no open task - normalized here so every "no task" path
     * below can rely on openTask always being an array.
     */
    openTask = (await getOpenTaskForWorkflowInstance(
      requestRow.workflowInstanceId,
    )) || [];
  } catch (error) {
    const status = error.response?.status || error.statusCode;

    /*
     * A 404 here means BPA has no record of this workflow instance
     * at all (it never existed, errored out before being indexed, or
     * was purged) - not a transient problem retrying would fix. This
     * app's own RequestApprovers rows are still the real source of
     * truth for who may approve (see README's authorization model),
     * so treat it the same as "no open task" below rather than
     * hard-blocking the approver indefinitely. Anything else (timeout,
     * 5xx, auth failure) stays a hard block - those usually ARE
     * transient and a blind approve could paper over a real outage.
     */
    if (status !== 404) {
      LOG.error(
        "Failed to look up the open task for this request.",
        JSON.stringify({
          requestId,
          workflowInstanceId: requestRow.workflowInstanceId,
          message: error.message,
          status,
        }),
      );

      request.error(
        502,
        "Unable to reach the approval workflow to process your decision.",
      );

      return null;
    }

    LOG.warn(
      "Workflow instance not found in BPA - treating as no open task.",
      JSON.stringify({
        requestId,
        workflowInstanceId: requestRow.workflowInstanceId,
      }),
    );
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
     * again. The same applies when the workflow instance is missing
     * from BPA entirely (see the 404 handling above) - either way,
     * there is nothing left for this app to complete there.
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

    /*
     * Genuinely no open task and no completed one either - most
     * often a workflow instance that errored out or never properly
     * registered in BPA (see the 404 handling above). This app's own
     * RequestApprovers row already confirmed this user has a
     * legitimate pending approval here, so let the decision proceed
     * through this app's own records rather than blocking the
     * approver indefinitely on a broken BPA side-channel - same
     * fallback as the "actioned externally" case above, just for a
     * different reason. Logged clearly so these can be audited.
     */
    LOG.warn(
      "No open or completed task found for this workflow instance - " +
        "proceeding on this app's own records only, without a BPA " +
        "task to complete.",
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

  const approverEmail = normalizeEmail(request.user?.id);

  const currentLevel = requestRow.currentApprovalLevel; // 1
  console.log("currentLevel:", currentLevel)

  const remainingPendingApproval = rows.filter(x => !approverRow.map(r => r.level).includes(x.level));

  const lastLevel = getLevelNumber(lastApprover.level); // 2
  console.log("lastLevel:", lastLevel)

  let nextLevel = Math.min(currentLevel + 1, lastLevel);
  console.log("nextLevel:", nextLevel)

  // Stop Update
  //
  // Generalized from a level-2-only check: lettered parallel
  // sub-levels (e.g. "1A"/"1B"/"1C" - CAP-owned Virement routing's
  // per-transfer-out-cost-center approvers) need the exact same
  // "don't advance until every sibling has acted" behavior this
  // already provided for level 2, at whatever level is currently
  // active.
  let remainingParallelApproval = false;
  if (remainingPendingApproval.length > 0) {
    nextLevel = currentLevel;
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
      .where({
        request_ID: requestId,
        level: { like: `${nextLevel}%` },   // contains "A"
      })
    );

    /*
     * Notify the newly-activated level's approvers directly via the
     * S/4 Email API, now that their RequestApprovers rows are
     * PENDING_APPROVAL - same "To Approver" content the Level 1
     * approvers got at submission (requests-after-create-logic.js),
     * rebuilt here since this is a separate request/transaction with
     * only a narrowly-selected requestRow in hand.
     */
    const nextLevelApprovers = await tx.run(
      SELECT.from(RequestApprovers)
        .columns("emailAddress")
        .where({
          request_ID: requestId,
          level: { like: `${nextLevel}%` },
          status_code: REQUEST_STATUS.PENDING_APPROVAL,
        }),
    );

    const emailContext = await loadEmailContext(tx, requestId);

    if (emailContext && nextLevelApprovers.length) {
      const toApproverEmail = await renderEmailConfig(
        tx,
        EMAIL_TYPE.TO_APPROVER,
        emailContext,
      );

      if (toApproverEmail) {
        await sendEmail({
          subject: toApproverEmail.subject,
          body: toApproverEmail.body,
          recipients: nextLevelApprovers.map((row) => row.emailAddress),
        });
      }
    }
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
          currentApprovalLevel: nextLevel,
          workflowStatus: newStatusCode === REQUEST_STATUS.APPROVED ? "COMPLETED" : "RUNNING",
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
      `${siblingEmails} were not required to act - request already approved by ${approverEmail}.`,
    );

    LOG.info(
      "Other Level pending approvers auto-resolved (rejected):",
      JSON.stringify({ requestId, siblingEmails }),
    );
  }

  if (syncOnly) {
    /*
     * No BPA task could be confirmed for this approval (the workflow
     * instance is missing from BPA, or was already completed outside
     * this app) - there is simply no BPA task left to complete.
     * This app's own RequestApprovers/Requests records remain
     * authoritative, so the decision proceeds - and, unlike before,
     * the S/4 posting below is NOT skipped: skipping it previously
     * left fully-"Approved" requests with no Transfer/Supplement/
     * Return document ever created in S/4 (the money never actually
     * moved), which was only discovered after the fact. taskIds is
     * already empty here, so the completeTask loop further down
     * stays a no-op without any extra guard.
     */
    await insertRequestHistory(
      request,
      requestId,
      `Approval status synced by ${approverEmail}: no BPA workflow ` +
        "task could be confirmed (missing or already completed " +
        "outside this app). Proceeding with S/4 posting on this " +
        "app's own records.",
    );

    LOG.warn(
      "No BPA task to complete for this approval - proceeding with " +
        "S/4 posting on this app's own records only.",
      JSON.stringify({ requestId, approverEmail }),
    );
  }

  let s4Result;

  if (newStatusCode === REQUEST_STATUS.APPROVED) {
    const isTransferWithEarmarkedFunds =
      requestRow.requestType_code === "T" &&
      Boolean(requestRow.earmarkedFundsDocNumber);

    const alreadyPosted =
      isTransferWithEarmarkedFunds && Boolean(requestRow.transferOutDocNumber);

    /*
     * Earmarked Funds must be completed FOR REAL before the Transfer
     * is posted, not after: while a document stays open, it keeps
     * holding its own budget reservation, which collides with the
     * Transfer posting's own Availability Control check - confirmed
     * live on N26000030, which failed with "Annual budget exceeded"
     * while its Earmarked Funds document was still open. request.error
     * is raised before the transaction commits, so nothing is posted
     * in S/4 and nothing is saved if this fails.
     *
     * The live status is checked first so a retry after a transient
     * failure here (or a request whose Transfer was already posted
     * previously) never tries to complete an already-complete document
     * a second time.
     */
    if (isTransferWithEarmarkedFunds) {
      try {
        const { isCompleted } = await getEarmarkedFundsDocumentStatus({
          documentNumber: requestRow.earmarkedFundsDocNumber,
        });

        if (!isCompleted) {
          await completeEarmarkedFundsDocument({
            documentNumber: requestRow.earmarkedFundsDocNumber,
          });

          LOG.info(
            "Earmarked Funds document marked complete ahead of S/4 posting.",
            JSON.stringify({
              requestId,
              earmarkedFundsDocNumber: requestRow.earmarkedFundsDocNumber,
            }),
          );
        }
      } catch (error) {
        LOG.error(
          "Earmarked Funds completion failed. The approval is not processed and nothing is posted.",
          JSON.stringify({
            requestId,
            earmarkedFundsDocNumber: requestRow.earmarkedFundsDocNumber,
            message: error.message,
          }),
        );

        request.error(
          error.statusCode || 422,
          `The approval cannot be processed because the Earmarked Funds document cannot be completed: ${error.message}`,
        );

        return;
      }
    }

    try {
      if (alreadyPosted) {
        s4Result = {
          documentNumbers: { TRAN: requestRow.transferOutDocNumber },
          earmarkedFundsDocNumber: requestRow.earmarkedFundsDocNumber,
        };

        LOG.info(
          "Transfer already posted - only syncing the approval now " +
            "(Earmarked Funds completion, if still needed, already ran above).",
          JSON.stringify({ requestId }),
        );
      } else {
        s4Result = await performPostToS4({
          tx,
          request,
          requestId,
          emailAddress: approverEmail,
        });

        LOG.info(
          "S/4 posting completed successfully.",
          JSON.stringify({ requestId, documentNumbers: s4Result.documentNumbers }),
        );
      }

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

  /*
   * Only the FINAL approval (request fully Completed, not just
   * advanced to the next level) notifies the requestor - an
   * intermediate level's approval has nothing to report to them yet.
   *
   * tx was already committed above (S/4 posting must be durable
   * before BPA is told the task is done) - a fresh transaction is
   * needed here rather than reusing it.
   */
  if (newStatusCode === REQUEST_STATUS.APPROVED) {
    // documentNumbers is keyed by posting type (TRAN/RETN/SUPL - see
    // post-to-s4-logic.js) - exactly one is set per request type.
    const documentNumber = Object.values(s4Result?.documentNumbers || {})[0];

    const { emailContext, approvedEmail } = await cds.tx(async (freshTx) => {
      const context = await loadEmailContext(freshTx, requestId);

      if (!context) {
        return {};
      }

      return {
        emailContext: context,
        approvedEmail: await renderEmailConfig(freshTx, EMAIL_TYPE.APPROVED, {
          ...context,
          documentNumber,
        }),
      };
    });

    if (emailContext && approvedEmail && requestRow.requestor) {
      await sendEmail({
        subject: approvedEmail.subject,
        body: approvedEmail.body,
        recipients: [requestRow.requestor],
      });
    }
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

  const { requestId, approverRow, row, lastApprover, taskIds, requestRow } =
    prepared;

  const approverEmail = normalizeEmail(request.user?.id);
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
          workflowStatus: "REJECTED",
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

  /*
   * tx was already committed above - a fresh transaction is needed
   * here, same reasoning as approveRequest's own final-approval email.
   */
  const { emailContext, rejectedEmail } = await cds.tx(async (freshTx) => {
    const context = await loadEmailContext(freshTx, requestId);

    if (!context) {
      return {};
    }

    return {
      emailContext: context,
      rejectedEmail: await renderEmailConfig(freshTx, EMAIL_TYPE.REJECTED, {
        ...context,
        rejectionReason: comment || "",
      }),
    };
  });

  if (emailContext && rejectedEmail && requestRow.requestor) {
    await sendEmail({
      subject: rejectedEmail.subject,
      body: rejectedEmail.body,
      recipients: [requestRow.requestor],
    });
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
  /*
   * The rejection is committed above, so this can only add to it: a
   * failure never blocks or undoes the rejection.
   */
  const earmarkedFunds = await completeEarmarkedFundsAfterRejection({
    requestId,
    requestRow,
  });

  if (earmarkedFunds.outcome === "failed") {
    request.warn(
      `Request rejected, but Earmarked Funds document ${earmarkedFunds.documentNumber} could not be marked complete: ${earmarkedFunds.message}. Please follow up manually.`,
    );

    return;
  }

  request.info('Request Rejected successfully');
}

module.exports = { approveRequest, rejectRequest };
