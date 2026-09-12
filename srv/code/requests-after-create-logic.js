const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const {
  HISTORY_MESSAGES,
  buildMessage,
} = require("./utils/history-messages");

const { startApprovalWorkflow } = require("./utils/workflow-utils");

const { applyApproverPlan } = require("./utils/apply-approver-plan");

const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("requests-after-create-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Returns the first created record.
 *
 * Handles both a single object and an array result.
 *
 * @param {object|object[]} results
 * @returns {object}
 */
function resolveCreatedRequest(results) {
  if (Array.isArray(results)) {
    return results[0] || {};
  }

  return results || {};
}

/**
 * Resolves the Request ID from the created result or request.data.
 *
 * @param {object|object[]} results
 * @param {cds.Request} request
 * @returns {string|null}
 */
function resolveRequestId(results, request) {
  const createdRequest = resolveCreatedRequest(results);

  return createdRequest.ID || request.data?.ID || null;
}

/**
 * Resolves the requester identity.
 *
 * @param {object} createdRequest
 * @param {cds.Request} request
 * @returns {string}
 */
function resolveRequestor(createdRequest, request) {
  return (
    createdRequest.createdBy ||
    request.data?.createdBy ||
    request.user?.id ||
    ""
  );
}

/**
 * Extracts a safe error message from the workflow HTTP error.
 *
 * @param {Error} error
 * @returns {string}
 */
function getWorkflowErrorMessage(error) {
  return (
    error.response?.data?.error?.message ||
    error.response?.data?.message ||
    error.message ||
    "Unknown workflow start error."
  );
}

/**
 * Extracts an appropriate HTTP status code.
 *
 * @param {Error} error
 * @returns {number}
 */
function getWorkflowErrorStatus(error) {
  const status = error.response?.status || error.statusCode || error.status;

  if (Number.isInteger(status) && status >= 400 && status <= 599) {
    return status;
  }

  /*
   * 502 indicates that the CAP service could not complete
   * the request because an upstream workflow service failed.
   */
  return 502;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @After(
 *   event = { "CREATE" },
 *   entity = "ZSVC_PPS_VIREMENT.Requests"
 * )
 *
 * Performs mandatory post-create processing inside the current
 * request transaction:
 *
 * 1. Resolves the created Request.
 * 2. Inserts the SUBMITTED history entry.
 * 3. Starts the SAP Build Process Automation workflow.
 *
 * IMPORTANT: For the request types covered by utils/approver-routing.js
 * (currently: all Supplement requests, and all Return requests,
 * regardless of Project vs Non Project budget type), this handler
 * resolves and persists the Level 1 approver(s) itself (see
 * applyApproverPlan below), and SAP Build's workflow reads that
 * assignment back from the Request instead of deciding it via its own
 * decision table - so the workflow must NOT also call assignApprovers
 * for those cases, to avoid a duplicate/conflicting Level 1 row.
 *
 * For every other combination (not yet migrated into CAP), this
 * handler does NOT retrieve or persist approvers. Polling the
 * workflow instance context REST API was attempted, but SAP Build
 * Process Automation rejected it with:
 *
 *   bpm.workflowruntime.rest.user.not.sufficient.privileges
 *
 * The API key used to start instances does not carry the
 * privileges required to read instance context. Reading context
 * requires a separate, more privileged OAuth2 client that is not
 * available for this integration.
 *
 * Instead, the workflow itself is responsible for calling back
 * into CAP via the `assignApprovers` action (see
 * srv/code/handlers/assign-approvers.js) using a Service/Script
 * Task placed immediately after each decision table in the BPMN
 * diagram. That task runs inside the workflow engine and does not
 * require the context-read permission.
 *
 * @param {object|object[]} results
 * @param {cds.Request} request
 */
module.exports = async function (results, request) {
  LOG.info("--- AFTER CREATE Requests started ---");

  try {
    LOG.info("Event:", request.event);

    LOG.info("Target:", request.target?.name);

    LOG.info("Results:", JSON.stringify(results || {}));

    const createdRequest = resolveCreatedRequest(results);

    LOG.info("createdRequest:", JSON.stringify(createdRequest || {}));

    LOG.info("request.data:", JSON.stringify(request.data || {}));

    /*
     * 1. Resolve the saved Request ID.
     */
    const requestId = resolveRequestId(results, request);

    if (!requestId) {
      const error = new Error(
        "The request was created without an ID. " +
          "The approval workflow cannot be started.",
      );

      error.statusCode = 500;
      throw error;
    }

    /*
     * Set by requests-before-create-logic.js: this same CREATE event
     * also fires when saving an edit of an already-submitted request
     * (Edit is allowed again once Pending Approval, to change Reason/
     * Asset Status only). None of the submission-only work below
     * (SUBMITTED history entry, CAP-owned approver plan, starting the
     * SAP Build workflow) may repeat in that case - it would reset
     * in-flight approval progress and start a duplicate workflow
     * instance every time the request is edited.
     */
    if (request._isFirstSubmission === false) {
      LOG.info(
        "Not a first submission - skipping submission-only " +
          "post-processing (history entry, approver plan, workflow " +
          "start).",
        JSON.stringify({ requestId }),
      );

      LOG.info("--- AFTER CREATE Requests ended (edit, not a submission) ---");

      return;
    }

    const requestType =
      createdRequest.requestType_code || request.data?.requestType_code || "";

    const requestNumber =
      createdRequest.requestNumber || request.data?.requestNumber || "";

    const requestLink =
      createdRequest.requestLink || request.data?.requestLink || "";
    
    // Add filter to first Item
    const lineitemCostCenter =
      createdRequest.RequestItems?.find(x => Number(x.transferInAmount))?.costCentre || request.data?.RequestItems?.find(x => Number(x.transferInAmount))?.costCentre || 
        createdRequest.RequestItems?.[0]?.costCentre || request.data?.RequestItems?.[0]?.costCentre || "";

    // Add filter for Transfer Out Items
    // V2: single transfer-out line item's Cost Centre (1st line only).
    const transferOutCostCenter =
      createdRequest.RequestItems?.find(x => Number(x.transferOutAmount))?.costCentre
        || request.data?.RequestItems?.find(x => Number(x.transferOutAmount))?.costCentre
        || "";

    const projectType =
      createdRequest.budgetType_code || request.data?.budgetType_code || "";

    // Supplement (S) and Return (R) requests report their total via
    // supplementAmount / returnAmount instead of transferOutAmount
    // when calling the approval workflow.
    let requestAmount;
    if (requestType === "S") {
      requestAmount =
        Number(createdRequest.supplementAmount) || Number(request.data?.supplementAmount) || 0;
    } else if (requestType === "R") {
      requestAmount =
        Number(createdRequest.returnAmount) || Number(request.data?.returnAmount) || 0;
    } else {
      requestAmount =
        Number(createdRequest.transferOutAmount) || Number(request.data?.transferOutAmount) || 0;
    }

    // request.data.submissionDate is set explicitly just above in
    // requests-before-create-logic.js, so it's reliably present here -
    // unlike createdAt, which this draft-activate flow's AFTER CREATE
    // results do not reliably carry.
    const creationDate =
      request.data?.submissionDate ||
      createdRequest.createdAt ||
      request.data?.createdAt ||
      new Date().toISOString();

    const requestor = resolveRequestor(createdRequest, request);

    // V2: single transfer-out line item's GL account.
    const transferOutGl =
      createdRequest.RequestItems?.find(x => Number(x.transferOutAmount))?.glAccount
        || request.data?.RequestItems?.find(x => Number(x.transferOutAmount))?.glAccount
        || "";

    // V2: up to 5 transfer-in line items, indexed into fixed slots.
    const transferInItems =
      createdRequest.RequestItems?.filter(x => Number(x.transferInAmount))
        || request.data?.RequestItems?.filter(x => Number(x.transferInAmount))
        || [];

    const [
      transferInCostCenter1,
      transferInCostCenter2,
      transferInCostCenter3,
      transferInCostCenter4,
      transferInCostCenter5,
    ] = [0, 1, 2, 3, 4].map(i => transferInItems[i]?.costCentre || "");

    const [
      transferInGl1,
      transferInGl2,
      transferInGl3,
      transferInGl4,
      transferInGl5,
    ] = [0, 1, 2, 3, 4].map(i => transferInItems[i]?.glAccount || "");

    LOG.info(
      "Resolved created request:",
      JSON.stringify({
        requestId,
        requestType,
        requestNumber,
        requestor,
        requestLink,
        lineitemCostCenter,
        transferOutCostCenter,
        projectType,
        requestAmount,
        transferOutGl,
        transferInCostCenter1,
        transferInCostCenter2,
        transferInCostCenter3,
        transferInCostCenter4,
        transferInCostCenter5,
        transferInGl1,
        transferInGl2,
        transferInGl3,
        transferInGl4,
        transferInGl5,
        creationDate,
      }),
    );

    /*
     * 2. Insert the SUBMITTED history entry.
     *
     * This participates in the current CAP request transaction.
     * It will be rolled back if workflow startup fails.
     */
    const inserted = await insertRequestHistory(
      request,
      requestId,
      HISTORY_MESSAGES.SUBMITTED,
    );

    LOG.info("RequestHistory inserted:", inserted);

    /*
     * 2a. Record the Earmarked Funds document, when one was created.
     *
     * The document itself is created Before CREATE (see
     * requests-before-create-logic.js) because a failure there must abort
     * the submission. History can only be written once the Request row
     * exists, so the entry is added here instead.
     */
    const earmarkedFundsDocNumber =
      createdRequest?.earmarkedFundsDocNumber || request.data?.earmarkedFundsDocNumber;

    if (earmarkedFundsDocNumber) {
      await insertRequestHistory(
        request,
        requestId,
        buildMessage.earmarkedFundsCreated(earmarkedFundsDocNumber),
      );

      LOG.info(
        "Earmarked Funds history entry inserted:",
        earmarkedFundsDocNumber,
      );
    }

    /*
     * 2b. Apply the CAP-owned approval plan, when this request's
     * (requestType, budgetType) matches a rule already migrated from
     * SAP Build's decision tables (see utils/approver-routing.js).
     * Must happen before the workflow starts, since the workflow's
     * own Supplement branch now reads the Level 1 approver(s) back
     * from the Request rather than deciding them itself.
     */
    const tx = cds.tx(request);

    const { Requests, RequestApprovers, RequestItems } =
      cds.entities(SERVICE_NAMESPACE);

    /*
     * Only Virement (Transfer) routing needs the full item list (see
     * utils/virement-scenario.js) - fetched fresh from the DB rather
     * than off createdRequest/request.data, since either may omit a
     * deep-insert's items depending on how Fiori Elements shaped the
     * activation payload.
     */
    let approvalPlanItems;

    if (requestType === "T") {
      approvalPlanItems = await tx.run(
        SELECT.from(RequestItems)
          .columns(
            "costCentre",
            "responsibleCostCentre",
            "glGroup",
            "department",
            "region",
            "branch",
            "functionalDepartment",
            "transferInAmount",
            "transferOutAmount",
          )
          .where({ request_ID: requestId })
          .orderBy("srNo"),
      );
    }

    const appliedApproverPlan = await applyApproverPlan({
      tx,
      RequestApproversTarget: RequestApprovers,
      requestId,
      requestTypeCode: requestType,
      budgetTypeCode: projectType,
      amount: requestAmount,
      items: approvalPlanItems,
    });

    for (const { level, emails } of appliedApproverPlan) {
      if (level.startsWith("1")) {
        await tx.run(
          UPDATE(Requests)
            .set({ currentApprovalLevel: 1 })
            .where({ ID: requestId }),
        );
      }

      await insertRequestHistory(
        request,
        requestId,
        `Level ${level} approvers assigned: ${emails.join(", ")}`,
      );
    }

    LOG.info(
      "CAP-owned approval plan applied at submit:",
      JSON.stringify(appliedApproverPlan),
    );

    /*
     * 3. Start the approval workflow.
     *
     * This is intentionally awaited inside the current handler.
     * Do not move this into request.on("succeeded") if workflow
     * startup is mandatory for completing the CREATE request.
     */
    LOG.info(
      "Starting mandatory approval workflow:",
      JSON.stringify({
        destination: "sap_process_automation_service",
        requestId,
        requestNumber,
      }),
    );

    const workflowInstance = await startApprovalWorkflow({
      requestId,
      requestType,
      requestNumber,
      requestor,
      requestLink,
      lineitemCostCenter,
      transferOutCostCenter,
      projectType,
      requestAmount,
      transferOutGl,
      transferInCostCenter1,
      transferInCostCenter2,
      transferInCostCenter3,
      transferInCostCenter4,
      transferInCostCenter5,
      transferInGl1,
      transferInGl2,
      transferInGl3,
      transferInGl4,
      transferInGl5,
      creationDate,
      appliedApproverPlan,
    });

    const workflowInstanceId =
      workflowInstance.id ||
      workflowInstance.instanceId ||
      workflowInstance.workflowInstanceId ||
      null;

    LOG.info(
      "Approval workflow started successfully:",
      JSON.stringify({
        requestId,
        requestNumber,
        workflowInstanceId,
        workflowStatus: workflowInstance.status || null,
      }),
    );

    if (workflowInstanceId) {
      await tx.run(
        UPDATE(Requests)
          .set({
            workflowInstanceId,
            workflowStatus: workflowInstance.status || null,
          })
          .where({ ID: requestId }),
      );
    } else {
      LOG.warn(
        "No workflowInstanceId returned. " +
          "Requests.workflowInstanceId will remain unset.",
        JSON.stringify({ requestId }),
      );
    }

    /*
     * For (requestType, budgetType) combinations not covered by
     * utils/approver-routing.js, Level 1 (and other level) approvers
     * are NOT assigned here. They arrive later via the assignApprovers
     * action, called by the workflow's own Service/Script Task once
     * its decision table resolves. Combinations that ARE covered were
     * already handled above, at step 2b, before the workflow started.
     */

    LOG.info("--- AFTER CREATE Requests ended successfully ---");
  } catch (error) {
    const statusCode = getWorkflowErrorStatus(error);

    const errorMessage = getWorkflowErrorMessage(error);

    LOG.error(
      "Request creation failed because the approval workflow " +
        "could not be started:",
      JSON.stringify({
        requestId: resolveRequestId(results, request),
        requestNumber:
          resolveCreatedRequest(results).requestNumber ||
          request.data?.requestNumber ||
          null,
        destination: "sap_process_automation_service",
        statusCode,
        message: errorMessage,
        responseData: error.response?.data || null,
      }),
    );

    throw Object.assign(
      new Error(
        "Request was not submitted because the approval " +
          `workflow could not be started: ${errorMessage}`,
      ),
      {
        statusCode,
        status: statusCode,
        cause: error,
      },
    );
  }
};
