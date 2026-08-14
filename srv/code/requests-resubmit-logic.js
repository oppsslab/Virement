const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { HISTORY_MESSAGES } = require("./utils/history-messages");

const { startApprovalWorkflow } = require("./utils/workflow-utils");

const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("requests-resubmit-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

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
    const lineitemCostCenter = createdRequestItems?.[0].costCentre || [];

    // Add filter for Transfer Out Items
    const transferOutCostCenter = createdRequestItems?.filter(x => Number(x.transferOutAmount))?.map(x => x.costCentre) || [];

    const projectType = createdRequest.budgetType_code || "";

    const requestAmount = Number(createdRequest.transferOutAmount) || 0;

    const requestor = resolveRequestor(createdRequest, request);

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
        requestAmount
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
      requestAmount
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
        UPDATE(Requests).set({ workflowInstanceId, status_code: REQUEST_STATUS.PENDING_APPROVAL }).where({ ID: requestId }),
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
