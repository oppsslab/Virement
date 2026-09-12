const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { HISTORY_MESSAGES } = require("./utils/history-messages");

const { startApprovalWorkflow } = require("./utils/workflow-utils");

const { REQUEST_STATUS } = require("./utils/request-status");

const { simulatePostToS4 } = require("./post-to-s4-logic");

const { hasRole } = require("./utils/role-check");

const {
  validateWbsForProjectBudget,
} = require("./utils/validate-wbs-for-project");

const LOG = cds.log("requests-resubmit-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/*
 * Only a BCM team member (see ams/dcl/cap/basePolicies.dcl POLICY
 * "VR_BCM") may resubmit a Return request that resolves to Budget
 * Zerorise ('Z') - same restriction as first submission (see
 * requests-before-create-logic.js), checked again here since a
 * rejected request can be edited (including its Return Category, for
 * Non Project) before resubmission.
 */
const ROLE_BCM = "BUDGET_ZERORISE";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

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
 * IMPORTANT: This handler does NOT retrieve or persist Level 1
 * approvers. Polling the workflow instance context REST API was
 * attempted, but SAP Build Process Automation rejected it with:
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
module.exports = async function (request) {
  LOG.info("--- AFTER CREATE Requests started ---");

  try {
    LOG.info("Event:", request.event);

    LOG.info("Target:", request.target?.name);

    LOG.info("request.data:", JSON.stringify(request.data || {}));

    const tx = cds.tx(request);

    const { Requests, RequestItems, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

    /*
     * 1. Resolve the saved Request ID.
     */
    const requestId = resolveRequestId(request);

    if (!requestId) {
      const error = new Error(
        "The request was created without an ID. " +
          "The approval workflow cannot be started.",
      );

      error.statusCode = 500;
      throw error;
    }

    const createdRequest = await tx.run(
      SELECT.one.from(Requests).where({ ID: requestId }),
    );

    const createdRequestItems = await tx.run(
      SELECT.from(RequestItems).where({ request_ID: requestId }),
    );

    const requestType = createdRequest.requestType_code || "";

    const requestNumber = createdRequest.requestNumber || "";

    const requestLink = createdRequest.requestLink || "";
    
    // Add filter to first Item
    const lineitemCostCenter = createdRequestItems?.[0]?.costCentre || "";

    // Add filter for Transfer Out Items
    // V2: single transfer-out line item's Cost Centre (1st line only).
    const transferOutCostCenter =
      createdRequestItems?.find(x => Number(x.transferOutAmount))?.costCentre || "";

    const projectType = createdRequest.budgetType_code || "";

    // Supplement (S) and Return (R) requests report their total via
    // supplementAmount / returnAmount instead of transferOutAmount
    // when calling the approval workflow.
    let requestAmount;
    if (requestType === "S") {
      requestAmount = Number(createdRequest.supplementAmount) || 0;
    } else if (requestType === "R") {
      requestAmount = Number(createdRequest.returnAmount) || 0;
    } else {
      requestAmount = Number(createdRequest.transferOutAmount) || 0;
    }

    const requestor = resolveRequestor(createdRequest, request);

    const creationDate =
      createdRequest.submissionDate ||
      createdRequest.createdAt ||
      new Date().toISOString();

    // V2: single transfer-out line item's GL account.
    const transferOutGl =
      createdRequestItems?.find(x => Number(x.transferOutAmount))?.glAccount || "";

    // V2: up to 5 transfer-in line items, indexed into fixed slots.
    const transferInItems =
      createdRequestItems?.filter(x => Number(x.transferInAmount)) || [];

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

    const workFlowInstanceId = createdRequestItems.workflowInstanceId;
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
     * 0a. Budget Zerorise is restricted to the BCM team - checked
     * again on resubmit since a rejected request can be edited
     * (including its Return Category, for Non Project) before
     * resubmission.
     */
    if (
      createdRequest.returnCategory_code === "Z" &&
      !hasRole(request.user, ROLE_BCM)
    ) {
      const roleError = new Error(
        "Resubmission failed validation - Budget Zerorise is " +
          "restricted to the BCM team.",
      );

      roleError.statusCode = 403;
      roleError.userMessage =
        "Only the BCM team can raise a Budget Zerorise return.";

      LOG.error(roleError.message, JSON.stringify({ requestId }));

      throw roleError;
    }

    /*
     * 0b. Validate WBS is filled on all items when Budget Type is
     * Project - a rejected request can be edited (including its
     * items) before resubmission, so this must be re-checked here
     * too, same as first submission (requests-before-create-logic.js).
     */
    const isWbsValid = validateWbsForProjectBudget(request, {
      items: createdRequestItems,
      budgetTypeCode: createdRequest.budgetType_code,
    });

    if (!isWbsValid) {
      LOG.error("Resubmission failed WBS validation for Project budget type.");

      return;
    }

    /*
     * 1a. Simulate the eventual S/4 posting (IV_TEST = "X" on
     * ZFM_FI_FMBB_UPLOAD) before this resubmission ever reaches an
     * approver again - same reasoning as the first-submission check
     * in requests-before-create-logic.js. Runs before anything below
     * is written, so a failure here leaves no history entry and never
     * starts a new workflow instance.
     */
    await simulatePostToS4({
      requestData: createdRequest,
      items: createdRequestItems,
    });

    LOG.info("S/4 posting simulation passed.");

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
    });

    const workflowInstanceId =
      workflowInstance.id ||
      workflowInstance.instanceId ||
      workflowInstance.workflowInstanceId ||
      null;

    const status_code = 2;

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
            status_code: REQUEST_STATUS.PENDING_APPROVAL,
          })
          .where({ ID: requestId }),
      );

      await tx.run(
        DELETE.from(RequestApprovers).where({ request_ID: requestId })
      );
    } else {
      LOG.warn(
        "No workflowInstanceId returned. " +
          "Requests.workflowInstanceId will remain unset.",
        JSON.stringify({ requestId }),
      );
    }

    /*
     * Level 1 approvers are NOT assigned here. They will arrive
     * later via the assignApprovers action, called by the
     * workflow's own Service/Script Task once the Level 1
     * decision table resolves.
     */

    LOG.info("--- AFTER CREATE Requests ended successfully ---");
  } catch (error) {
    /*
     * The S/4 posting simulation (step 1a above) fails with its own
     * clear, accurate message (e.g. "Line 1: Cost Center is missing")
     * - rethrow it as-is rather than wrapping it in the "approval
     * workflow could not be started" message below, which would be
     * misleading (the workflow was never even reached).
     */
    if (error.statusCode && error.userMessage !== undefined) {
      LOG.error(
        "Resubmission failed S/4 posting simulation:",
        JSON.stringify({
          requestId: resolveRequestId(request),
          statusCode: error.statusCode,
          message: error.message,
        }),
      );

      throw error;
    }

    const statusCode = getWorkflowErrorStatus(error);

    const errorMessage = getWorkflowErrorMessage(error);

    LOG.error(
      "Request creation failed because the approval workflow " +
        "could not be started:",
      JSON.stringify({
        requestId: resolveRequestId(request),
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
