const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");

const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("workflow-utils");

const WORKFLOW_DESTINATION = "sap_process_automation_service";

// V1 workflow - commented out while switching to V2 below.
// const WORKFLOW_DEFINITION_ID =
//   "ap11.epf-ent-cf-ap11-dev.virementapprovalworkflow.approvalWorkflow";

const WORKFLOW_DEFINITION_ID =
  "ap11.epf-ent-cf-ap11-dev.virementapprovalworkflowv2.approvalWorkflow";

const WORKFLOW_START_PATH =
  "/workflow/rest/v1/workflow-instances?environmentId=nonprd";

const TASK_INSTANCES_PATH = "/workflow/rest/v1/task-instances";

const TASK_INSTANCE_PATH = (taskId) =>
  `/workflow/rest/v1/task-instances/${taskId}`;

const WORKFLOW_INSTANCE_PATH = (workflowInstanceId) =>
  `/workflow/rest/v1/workflow-instances/${workflowInstanceId}`;

const WORKFLOW_INSTANCE_ERROR_MESSAGES_PATH = (workflowInstanceId) =>
  `/workflow/rest/v1/workflow-instances/${workflowInstanceId}/error-messages`;

const WORKFLOW_INSTANCE_EXECUTION_LOGS_PATH = (workflowInstanceId) =>
  `/workflow/rest/v1/workflow-instances/${workflowInstanceId}/execution-logs`;

/*
 * Workflow instance statuses that indicate an execution error, worth
 * fetching error-messages for. Different API versions have been
 * observed to use either of these values.
 */
const ERROR_WORKFLOW_STATUSES = ["ERRONEOUS", "ERROR"];

const ENVIRONMENT_ID = "nonprd";

/*
 * Task statuses considered "still open / awaiting action" by the
 * SAP Build Process Automation Task Instance API. Different API
 * versions have been observed to use either of these values, so
 * both are checked when filtering for an open task.
 */
const OPEN_TASK_STATUSES = ["READY", "OPEN"];

/**
 * Finds a destination property using case-insensitive matching.
 *
 * SAP Cloud SDK versions may expose custom destination properties in:
 *
 * - destination
 * - destination.originalProperties
 * - destination.originalProperties.destinationConfiguration
 *
 * @param {object} destination
 * @param {string[]} propertyNames
 * @returns {string|null}
 */
function getDestinationProperty(destination, propertyNames) {
  const originalProperties = destination?.originalProperties || {};

  const destinationConfiguration =
    originalProperties?.destinationConfiguration || {};

  const propertyContainers = [
    destination,
    originalProperties,
    destinationConfiguration,
  ];

  const normalizedNames = propertyNames.map(function (propertyName) {
    return String(propertyName).trim().toLowerCase();
  });

  for (const container of propertyContainers) {
    if (!container || typeof container !== "object") {
      continue;
    }

    for (const [key, value] of Object.entries(container)) {
      const normalizedKey = String(key).trim().toLowerCase();

      if (!normalizedNames.includes(normalizedKey)) {
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      const normalizedValue = String(value).trim();

      if (normalizedValue) {
        return normalizedValue;
      }
    }
  }

  return null;
}

/**
 * Resolves the Process Automation destination and retrieves
 * the API key from its additional properties.
 *
 * Supported additional-property names:
 *
 * - apiKey
 * - apikey
 * - api-key
 * - irpa-api-key
 * - URL.headers.api-key
 * - URL.headers.irpa-api-key
 *
 * @returns {Promise<{
 *   destination: object,
 *   apiKey: string
 * }>}
 */
async function getProcessAutomationDestination() {
  const destination = await getDestination({
    destinationName: WORKFLOW_DESTINATION,
    useCache: false,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${WORKFLOW_DESTINATION}' was not found.`,
    );

    error.statusCode = 502;

    throw error;
  }

  const originalProperties = destination.originalProperties || {};

  const destinationConfiguration =
    originalProperties.destinationConfiguration || {};

  /*
   * Log only destination metadata and property names.
   *
   * Never log:
   * - API key value
   * - Client secret
   * - OAuth access token
   * - Authorization header
   * - Complete destination object
   */
  LOG.info(
    "Process Automation destination retrieved.",
    JSON.stringify({
      name: destination.name || WORKFLOW_DESTINATION,

      url: destination.url,

      authentication: destination.authentication,

      proxyType: destination.proxyType,

      destinationPropertyNames: Object.keys(destination),

      originalPropertyNames: Object.keys(originalProperties),

      destinationConfigurationPropertyNames: Object.keys(
        destinationConfiguration,
      ),
    }),
  );

  const apiKey = getDestinationProperty(destination, [
    "apiKey",
    "apikey",
    "api-key",
    "irpa-api-key",
    "URL.headers.api-key",
    "URL.headers.irpa-api-key",
  ]);

  if (!apiKey) {
    LOG.error(
      "API key was not found in the resolved destination.",
      JSON.stringify({
        destination: WORKFLOW_DESTINATION,

        destinationPropertyNames: Object.keys(destination),

        originalPropertyNames: Object.keys(originalProperties),

        destinationConfigurationPropertyNames: Object.keys(
          destinationConfiguration,
        ),
      }),
    );

    const error = new Error(
      `The destination '${WORKFLOW_DESTINATION}' ` +
        "does not expose an API key. Add an additional " +
        "property named apiKey, or check the logged " +
        "destination property names.",
    );

    error.statusCode = 500;

    throw error;
  }

  LOG.info(
    "Process Automation API key found in destination.",
    JSON.stringify({
      apiKeyPresent: true,
      apiKeyLength: apiKey.length,
    }),
  );

  return {
    destination,
    apiKey,
  };
}

/**
 * Starts the SAP Build Process Automation approval workflow.
 *
 * @param {object} options
 * @param {string} options.requestId
 * @param {string} options.requestType
 * @param {string} options.requestNumber
 * @param {string} options.requestor
 * @param {string} options.requestLink
 * @returns {Promise<object>}
 */
/*
 * The workflow's Configure Process Inputs exposes approvallevel1/2/3,
 * plus lettered overflow parameters per level (approvallevel1a..1e,
 * etc.) for INDEPENDENT parallel approvers at that level - e.g.
 * Virement's "Head of Transfer-out Cost Center", resolved once per
 * transfer-out line item (see utils/virement-scenario.js), sent as
 * "1A" for line 1, "1B" for line 2, and so on. Despite the "String"
 * type shown in the workflow's own input configuration screen, the
 * actual runtime schema requires every one of these as an ARRAY
 * (confirmed via a live "must be of array type" validation error) -
 * so each level/sub-level's approver email(s) go into their own
 * array-valued field. Field names are intentionally all-lowercase to
 * exactly match the workflow's own technical parameter names.
 */
const MAX_APPROVAL_LEVEL = 3;

/**
 * Builds the approvallevel1/2/3 (and, where the plan has them,
 * lettered approvallevel1a/1b/... sub-level) workflow input fields
 * from the CAP-owned approval plan applied at submit time (see
 * utils/apply-approver-plan.js), so the workflow receives the
 * already-resolved approver email(s) directly at start, instead of
 * looking them up itself mid-process for the levels CAP now owns.
 *
 * The 3 base numeric levels are always present (even empty), since
 * the workflow's schema requires them; a request type CAP doesn't own
 * routing for yet (or a level/sub-level a rule doesn't use) simply
 * leaves its field as an empty array - the workflow's own decision
 * tables + assignApprovers callback remain fully responsible for it.
 *
 * @param {{level: string, emails: string[]}[]} appliedApproverPlan
 * @returns {object} e.g. {approvallevel1: [], approvallevel1a: ["a@x.com"], approvallevel1b: ["b@x.com"], approvallevel2: ["c@x.com"], approvallevel3: []}
 */
function buildApprovalLevelFields(appliedApproverPlan) {
  const fields = {};

  for (let level = 1; level <= MAX_APPROVAL_LEVEL; level++) {
    fields[`approvallevel${level}`] = [];
  }

  for (const entry of appliedApproverPlan || []) {
    const fieldName = `approvallevel${String(entry.level || "").toLowerCase()}`;

    fields[fieldName] = entry.emails || [];
  }

  return fields;
}

async function startApprovalWorkflow({
  requestId,
  requestType,
  requestNumber,
  requestor,
  requestLink,
  lineitemCostCenter,
  transferOutCostCenter,
  projectType,
  requestAmount,
  creationDate,
  appliedApproverPlan,
  // V2 fields below. See callers for how each is derived.
  isAuthorisedFunctionalDept,
  isDifferentGlGroup,
  isSameRegion,
  isDifferentBranch,
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
}) {
  if (!requestId) {
    const error = new Error(
      "Request ID is required to start " + "the approval workflow.",
    );

    error.statusCode = 400;

    throw error;
  }

  const normalizedRequestType = String(requestType || "")
    .trim()
    .toUpperCase();

  /*
   * The context property names must exactly match the
   * workflow process input/context schema.
   */
  const payload = {
    definitionId: WORKFLOW_DEFINITION_ID,

    // V1 context shape - commented out while switching to V2 below.
    // context: {
    //   requestId,
    //   requesttype: normalizedRequestType,
    //   requestNumber: requestNumber || "",
    //   requestor: requestor || "",
    //   requestLink: requestLink || "",
    //   lineitemCostCenter: lineitemCostCenter || "",
    //   transferOutCostCenter: transferOutCostCenter,
    //   projectType: projectType || "",
    //   requestAmount: requestAmount || 0
    // },

    context: {
      requestType: normalizedRequestType,

      requestNumber: requestNumber || "",

      requestor: requestor || "",

      requestLink: requestLink || "",

      requestId,

      creationDate: creationDate || "",

      transferOutCostCenter: transferOutCostCenter || "",

      projectType: projectType || "",

      requestAmount: requestAmount || 0,

      /*
       * TODO: no existing business logic computes these four flags
       * anywhere in the codebase yet (confirmed via full-repo
       * search). Defaulting to false until the actual approval
       * routing rule for each is confirmed - do not rely on these
       * for real approval decisions until they are wired up
       * correctly, since getting them wrong could misroute an
       * approval.
       */
      isAuthorisedFunctionalDept: Boolean(isAuthorisedFunctionalDept),

      isDifferentGlGroup: Boolean(isDifferentGlGroup),

      isSameRegion: Boolean(isSameRegion),

      isDifferentBranch: Boolean(isDifferentBranch),

      transferOutGl: transferOutGl || "",

      transferInCostCenter1: transferInCostCenter1 || "",

      transferInCostCenter2: transferInCostCenter2 || "",

      transferInCostCenter3: transferInCostCenter3 || "",

      transferInCostCenter4: transferInCostCenter4 || "",

      transferInCostCenter5: transferInCostCenter5 || "",

      transferInGl1: transferInGl1 || "",

      transferInGl2: transferInGl2 || "",

      transferInGl3: transferInGl3 || "",

      transferInGl4: transferInGl4 || "",

      transferInGl5: transferInGl5 || "",

      ...buildApprovalLevelFields(appliedApproverPlan),
    },
  };

  /*
   * Resolve the destination and retrieve the custom apiKey
   * property before making the HTTP request.
   */
  const { destination, apiKey } = await getProcessAutomationDestination();

  LOG.info(
    "Starting approval workflow.",
    JSON.stringify({
      destination: WORKFLOW_DESTINATION,

      definitionId: WORKFLOW_DEFINITION_ID,

      requestId,

      requestType: normalizedRequestType,

      requestNumber: requestNumber || "",
    }),
  );

  /*
   * The Process Automation workflow endpoint reported that
   * the required header name is irpa-api-key.
   */
  const response = await executeHttpRequest(
    destination,
    {
      method: "POST",

      url: WORKFLOW_START_PATH,

      headers: {
        Accept: "application/json",

        "Content-Type": "application/json",

        "irpa-api-key": apiKey,
      },

      data: payload,
    },
    {
      /*
       * Starting the workflow does not require a CSRF token.
       */
      fetchCsrfToken: false,
    },
  );

  if (!response?.data) {
    const error = new Error(
      "SAP Build Process Automation " + "returned an empty response.",
    );

    error.statusCode = 502;

    throw error;
  }

  const workflowInstanceId =
    response.data.id ||
    response.data.instanceId ||
    response.data.workflowInstanceId ||
    null;

  LOG.info(
    "Approval workflow start request completed.",
    JSON.stringify({
      requestId,

      workflowInstanceId,

      workflowStatus: response.data.status || null,

      /*
       * Log the full raw response once here. This is safe: it
       * does not contain the API key or any authentication
       * material, only workflow instance metadata. This is
       * useful to confirm the actual field name used for the
       * instance ID if workflowInstanceId above is ever null.
       */
      rawResponse: JSON.stringify(response.data),
    }),
  );

  if (!workflowInstanceId) {
    LOG.error(
      "Workflow started but no recognizable instance ID field " +
        "was found in the response. Checked: id, instanceId, " +
        "workflowInstanceId.",
      JSON.stringify({ requestId, rawResponse: response.data }),
    );
  }

  return response.data;
}

/**
 * Fetches every task instance SAP Build Process Automation has for
 * the given workflow instance, regardless of status.
 *
 * Shared by getOpenTaskForWorkflowInstance and
 * getCompletedTaskForWorkflowInstance, which each filter the same
 * raw list down to the status they care about.
 *
 * @param {string} workflowInstanceId
 * @returns {Promise<object[]>}
 */
async function fetchTaskInstances(workflowInstanceId) {
  const { destination, apiKey } = await getProcessAutomationDestination();

  LOG.info(
    "Querying task instances for workflow instance.",
    JSON.stringify({ workflowInstanceId }),
  );

  let response;

  try {
    response = await executeHttpRequest(
      destination,
      {
        method: "GET",

        url: TASK_INSTANCES_PATH,

        params: {
          workflowInstanceId,
          environmentId: ENVIRONMENT_ID,
        },

        headers: {
          Accept: "application/json",

          "irpa-api-key": apiKey,
        },
      },
      { fetchCsrfToken: false },
    );
  } catch (error) {
    const status = error.response?.status || error.statusCode;

    LOG.error(
      "Task instance query failed.",
      JSON.stringify({
        workflowInstanceId,
        status,
        message: error.response?.data?.message || error.message,
        responseData: error.response?.data || null,
      }),
    );

    throw error;
  }

  /*
   * The response shape may be a plain array, or an object wrapping
   * the array under a property such as "content" or "value",
   * depending on the API version. All are checked here.
   */
  const rawData = response?.data;

  const taskInstances = Array.isArray(rawData)
    ? rawData
    : rawData?.content || rawData?.value || [];

  LOG.info(
    "Task instances retrieved.",
    JSON.stringify({
      workflowInstanceId,
      count: taskInstances.length,
      rawResponse: JSON.stringify(rawData),
    }),
  );

  return taskInstances;
}

/**
 * Fetches the current status of a single workflow instance directly
 * from SAP Build Process Automation, for live-refreshing
 * Requests.workflowStatus when a request is opened (rather than
 * relying on the last snapshot CAP happened to persist).
 *
 * Confirmed via direct testing (Postman, then curl) that this
 * endpoint - unlike task-instances and starting a workflow - expects
 * the header name "api-key", not "irpa-api-key". Sending the wrong
 * header name is what actually produced the persistent
 * "insufficient privileges" 403 seen here previously; the
 * client-credentials destination and API key were fine all along.
 *
 * @param {string} workflowInstanceId
 * @returns {Promise<string|null>} the current status (e.g. "RUNNING",
 *   "COMPLETED"), or null if it could not be determined
 */
async function getWorkflowInstanceStatus(workflowInstanceId) {
  if (!workflowInstanceId) {
    return null;
  }

  try {
    const { destination, apiKey } = await getProcessAutomationDestination();

    const response = await executeHttpRequest(
      destination,
      {
        method: "GET",

        url: WORKFLOW_INSTANCE_PATH(workflowInstanceId),

        params: {
          environmentId: ENVIRONMENT_ID,
        },

        headers: {
          Accept: "application/json",

          "api-key": apiKey,
        },
      },
      { fetchCsrfToken: false },
    );

    const status = response?.data?.status || null;

    LOG.info(
      "Workflow instance status fetched.",
      JSON.stringify({ workflowInstanceId, status }),
    );

    return status;
  } catch (error) {
    const status = error.response?.status || error.statusCode;

    LOG.error(
      "Failed to fetch workflow instance status.",
      JSON.stringify({
        workflowInstanceId,
        status,
        message: error.response?.data?.message || error.message,
        responseData: error.response?.data || null,
      }),
    );

    return null;
  }
}

/**
 * Fetches the execution error message(s) for a workflow instance
 * that has failed (e.g. status "ERRONEOUS"), for display as a
 * tooltip on Requests.workflowStatus (see Common.QuickInfo on
 * workflowStatus in annotations.cds).
 *
 * @param {string} workflowInstanceId
 * @returns {Promise<string|null>} the joined error message(s), or
 *   null if there are none or they could not be fetched
 */
async function getWorkflowInstanceErrorMessages(workflowInstanceId) {
  if (!workflowInstanceId) {
    return null;
  }

  try {
    const { destination, apiKey } = await getProcessAutomationDestination();

    const response = await executeHttpRequest(
      destination,
      {
        method: "GET",

        url: WORKFLOW_INSTANCE_ERROR_MESSAGES_PATH(workflowInstanceId),

        params: {
          environmentId: ENVIRONMENT_ID,
        },

        headers: {
          Accept: "application/json",

          "api-key": apiKey,
        },
      },
      { fetchCsrfToken: false },
    );

    const errorMessages = Array.isArray(response?.data) ? response.data : [];

    if (!errorMessages.length) {
      return null;
    }

    const joined = errorMessages
      .map((entry) =>
        entry.activityName
          ? `${entry.activityName}: ${entry.message}`
          : entry.message,
      )
      .filter(Boolean)
      .join("\n");

    LOG.info(
      "Workflow instance error messages fetched.",
      JSON.stringify({ workflowInstanceId, count: errorMessages.length }),
    );

    return joined || null;
  } catch (error) {
    const status = error.response?.status || error.statusCode;

    LOG.error(
      "Failed to fetch workflow instance error messages.",
      JSON.stringify({
        workflowInstanceId,
        status,
        message: error.response?.data?.message || error.message,
      }),
    );

    return null;
  }
}

/**
 * Fetches the full execution log for a workflow instance from SAP
 * Build Process Automation, for display as a read-only table on the
 * Request's Object Page (see WorkflowLogs in service.cds).
 *
 * Log entries vary in shape by "type" (WORKFLOW_STARTED,
 * SERVICETASK_CREATED, USERTASK_CLAIMED, ...); only the fields common
 * enough to be useful across all of them are surfaced here. "message"
 * is populated only for entries that carry an error (mirrors what
 * getWorkflowInstanceErrorMessages shows), left blank otherwise.
 *
 * @param {string} workflowInstanceId
 * @returns {Promise<object[]>} rows shaped for the WorkflowLogs
 *   entity: {logId, workflowInstanceId, timestamp, type,
 *   activityName, message}
 */
async function getWorkflowInstanceExecutionLogs(workflowInstanceId) {
  if (!workflowInstanceId) {
    return [];
  }

  try {
    const { destination, apiKey } = await getProcessAutomationDestination();

    const response = await executeHttpRequest(
      destination,
      {
        method: "GET",

        url: WORKFLOW_INSTANCE_EXECUTION_LOGS_PATH(workflowInstanceId),

        headers: {
          Accept: "application/json",

          "api-key": apiKey,
        },
      },
      { fetchCsrfToken: false },
    );

    const entries = Array.isArray(response?.data) ? response.data : [];

    LOG.info(
      "Workflow instance execution logs fetched.",
      JSON.stringify({ workflowInstanceId, count: entries.length }),
    );

    return entries.map((entry) => ({
      logId: String(entry.id ?? ""),
      workflowInstanceId,
      timestamp: entry.timestamp || null,
      type: entry.type || "",
      activityName: entry.subject || entry.activityId || "",
      message: (entry.error && entry.error.message) || "",
    }));
  } catch (error) {
    const status = error.response?.status || error.statusCode;

    LOG.error(
      "Failed to fetch workflow instance execution logs.",
      JSON.stringify({
        workflowInstanceId,
        status,
        message: error.response?.data?.message || error.message,
      }),
    );

    return [];
  }
}

/**
 * Queries SAP Build Process Automation for task instances matching
 * the given workflow instance ID, and returns the first task that
 * is still open (awaiting a decision).
 *
 * This is used so the CAP app's own Approve/Reject buttons can
 * discover the correct taskId to complete, without needing BPA to
 * proactively report it back to CAP when the task is first created.
 *
 * @param {string} workflowInstanceId
 * @returns {Promise<object|null>} the raw open task instance
 *   object, or null if none is found
 */
async function getOpenTaskForWorkflowInstance(workflowInstanceId) {
  if (!workflowInstanceId) {
    LOG.error("Cannot look up task instances without a workflowInstanceId.");

    return null;
  }

  const taskInstances = await fetchTaskInstances(workflowInstanceId);

  const openTask = taskInstances.filter(function (task) {
    const status = String(task?.status || "")
      .trim()
      .toUpperCase();

    return OPEN_TASK_STATUSES.includes(status);
  });

  if (!openTask.length) {
    LOG.warn(
      "No open task instance found for workflow instance.",
      JSON.stringify({ workflowInstanceId }),
    );

    return null;
  }

  LOG.info(
    "Open task instance found.",
    JSON.stringify({
      workflowInstanceId,
      tasks: openTask
    }),
  );

  return openTask;
}

/**
 * Reports whether SAP Build Process Automation shows a COMPLETED
 * task for the given workflow instance.
 *
 * A task ends up completed outside of this app's own Approve/Reject
 * buttons when someone actions it directly in BPA's My Inbox - most
 * often because the CAP-side flow errored partway through (e.g. an
 * S/4 posting rejection) and the user worked around it there instead.
 * When that happens, getOpenTaskForWorkflowInstance correctly finds
 * no open task, but this app's own RequestApprovers/Requests rows
 * are left stuck Pending with no task left to complete. This lets
 * the Approve/Reject handlers recognize that case and resync their
 * own records instead of dead-ending with "already actioned".
 *
 * @param {string} workflowInstanceId
 * @returns {Promise<boolean>}
 */
async function hasCompletedTaskForWorkflowInstance(workflowInstanceId) {
  if (!workflowInstanceId) {
    return false;
  }

  const taskInstances = await fetchTaskInstances(workflowInstanceId);

  return taskInstances.some(function (task) {
    return String(task?.status || "").trim().toUpperCase() === "COMPLETED";
  });
}

/**
 * Completes a SAP Build Process Automation task instance, routing
 * the workflow down the Approve or Reject branch accordingly.
 *
 * No business data needs to be passed in the completion context.
 * "Request Approval Form" is a native Approve/Reject form template
 * with no support for custom output fields, so it cannot carry
 * values like the approver's email or a comment back into the
 * workflow's own data model. All approver-identity handling,
 * RequestApprovers/Requests status updates, and S/4 posting are
 * now done directly in CAP (see approve-reject-request.js and
 * post-to-s4-logic.js) BEFORE this function is ever called. This
 * call's only remaining purpose is to formally close the task so
 * the workflow instance advances down the correct branch and does
 * not hang open indefinitely.
 *
 * @param {object} options
 * @param {string} options.taskId
 * @param {string} options.decision "APPROVED" or "REJECTED"
 *   (used only for logging here; the actual branch taken in BPA
 *   is determined by the task's own Approve/Reject completion,
 *   not by a value in this payload)
 * @param {string} [options.comment]
 * @returns {Promise<object>}
 */
async function completeTask({ taskId, decision, comment }) {
  if (!taskId) {
    const error = new Error("taskId is required to complete a task.");

    error.statusCode = 400;

    throw error;
  }

  const { destination, apiKey } = await getProcessAutomationDestination();

  const payload = {
    status: "COMPLETED",
    decision: decision,
    context: {
      comment: comment || "",
    },
  };

  LOG.info(
    "Completing task instance.",
    JSON.stringify({ taskId, decision, hasComment: Boolean(comment) }),
  );

  try {
    const response = await executeHttpRequest(
      destination,
      {
        method: "PATCH",

        url: TASK_INSTANCE_PATH(taskId),

        headers: {
          Accept: "application/json",

          "Content-Type": "application/json",

          "irpa-api-key": apiKey,
        },

        data: payload,
      },
      { fetchCsrfToken: false },
    );

    LOG.info(
      "Task instance completed successfully.",
      JSON.stringify({
        taskId,
        rawResponse: JSON.stringify(response?.data || {}),
      }),
    );

    return response?.data || {};
  } catch (error) {
    const status = error.response?.status || error.statusCode;

    LOG.error(
      "Task instance completion failed.",
      JSON.stringify({
        taskId,
        status,
        message: error.response?.data?.message || error.message,
        responseData: error.response?.data || null,
      }),
    );

    throw error;
  }
}

module.exports = {
  startApprovalWorkflow,
  getProcessAutomationDestination,
  getDestinationProperty,
  getOpenTaskForWorkflowInstance,
  hasCompletedTaskForWorkflowInstance,
  getWorkflowInstanceStatus,
  getWorkflowInstanceErrorMessages,
  getWorkflowInstanceExecutionLogs,
  ERROR_WORKFLOW_STATUSES,
  completeTask,
};
