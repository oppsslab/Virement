const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");

const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("workflow-utils");

const WORKFLOW_DESTINATION = "sap_process_automation_service";

const WORKFLOW_DEFINITION_ID =
  "ap11.epf-ent-cf-ap11-dev.virementapprovalworkflow.approvalWorkflow";

const WORKFLOW_START_PATH =
  "/workflow/rest/v1/workflow-instances?environmentId=nonprd";

const TASK_INSTANCES_PATH = "/workflow/rest/v1/task-instances";

const TASK_INSTANCE_PATH = (taskId) =>
  `/workflow/rest/v1/task-instances/${taskId}`;

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
async function startApprovalWorkflow({
  requestId,
  requestType,
  requestNumber,
  requestor,
  requestLink,
  lineitemCostCenter,
  transferOutCostCenter,
  projectType,
  requestAmount
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

    context: {
      requestId,

      /*
       * Keep this as requesttype if that is the exact name
       * configured in the workflow context.
       */
      requesttype: normalizedRequestType,

      requestNumber: requestNumber || "",

      requestor: requestor || "",

      requestLink: requestLink || "",

      lineitemCostCenter: lineitemCostCenter || "",

      transferOutCostCenter: transferOutCostCenter,

      projectType: projectType || "",

      requestAmount: requestAmount || 0
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
  completeTask,
};
