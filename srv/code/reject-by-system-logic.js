"use strict";

const cds = require("@sap/cds");

const {
  getOpenTaskForWorkflowInstance,
  completeTask,
} = require("./utils/workflow-utils");

const { formatLocalDate, formatLocalTime } = require("./utils/date-utils");
const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");
const {
  completeEarmarkedFundsAfterRejection,
} = require("./utils/earmarked-funds-rejection");

const LOG = cds.log("reject-by-system-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const SYSTEM_IDENTITY = "System";

const DECISION_REJECTED = "reject";

function resolveRequestId(request) {
  return request.params?.[0]?.ID || request.data?.ID || null;
}

/**
 * @On("rejectBySystem")
 *
 * Admin-only. Rejects a Pending Approval request on the system's own
 * behalf (e.g. one stuck at an approver who cannot act), without
 * being any approver. Every history entry and the approver rows are
 * attributed to "System", never to the admin who pressed the button.
 *
 * @param {cds.Request} request
 */
module.exports = async function rejectBySystem(request) {
  const requestId = resolveRequestId(request);

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");

    return;
  }

  const comment = String(request.data?.comment ?? "").trim();

  const tx = cds.tx(request);

  const { Requests, RequestApprovers, RequestHistory } =
    cds.entities(SERVICE_NAMESPACE);

  const requestRow = await tx.run(
    SELECT.one
      .from(Requests)
      .columns(
        "ID",
        "requestNumber",
        "status_code",
        "workflowInstanceId",
        "requestType_code",
        "earmarkedFundsDocNumber",
      )
      .where({ ID: requestId }),
  );

  if (!requestRow) {
    request.error(404, `Request ${requestId} was not found.`);

    return;
  }

  if (requestRow.status_code !== REQUEST_STATUS.PENDING_APPROVAL) {
    request.error(
      409,
      "Only a request that is Pending Approval can be rejected by the system.",
    );

    return;
  }

  const rejectionText =
    "Rejected by System." + (comment ? ` Comment: ${comment}` : "");

  const now = new Date();

  await tx.run(
    UPDATE(RequestApprovers)
      .set({
        status_code: APPROVER_STATUS.REJECTED,
        actionDate: now.toISOString(),
        comment: "Rejected by System.",
      })
      .where({
        request_ID: requestId,
        status_code: APPROVER_STATUS.PENDING_APPROVAL,
      }),
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

  await tx.run(
    INSERT.into(RequestHistory).entries({
      request_ID: requestId,
      date: formatLocalDate(now),
      time: formatLocalTime(now),
      changedBy: SYSTEM_IDENTITY,
      changes: rejectionText,
    }),
  );

  LOG.info(
    "Request rejected by system.",
    JSON.stringify({
      requestId,
      requestNumber: requestRow.requestNumber,
      triggeredBy: request.user?.id,
    }),
  );

  /*
   * Best effort, after the local rejection above: close any open BPA
   * task so the workflow instance does not stay RUNNING. A failure
   * here is logged only - the request is already rejected locally.
   */
  if (requestRow.workflowInstanceId) {
    try {
      const openTasks =
        (await getOpenTaskForWorkflowInstance(requestRow.workflowInstanceId)) ||
        [];

      for (const task of openTasks) {
        await completeTask({
          taskId: task.id || task.taskId,
          decision: DECISION_REJECTED,
        });
      }
    } catch (error) {
      LOG.error(
        "Request was rejected, but the BPA task could not be completed. " +
          "The workflow instance may remain open (Monitor Workflows).",
        JSON.stringify({ requestId, message: error.message }),
      );
    }
  }

  /*
   * Save the rejection before calling S/4: completing the Earmarked
   * Funds document cannot be rolled back, so it must never happen for a
   * rejection that was not persisted. Best-effort from here on.
   */
  await tx.commit();

  const earmarkedFunds = await completeEarmarkedFundsAfterRejection({
    requestId,
    requestRow,
  });

  if (earmarkedFunds.outcome === "failed") {
    request.warn(
      `Request rejected by System, but Earmarked Funds document ${earmarkedFunds.documentNumber} could not be marked complete: ${earmarkedFunds.message}. Please follow up manually.`,
    );

    return;
  }

  request.info("Request rejected by System.");
};
