const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");

const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("workflow-utils");

const WORKFLOW_DESTINATION = "sap_process_automation_service";

const WORKFLOW_DEFINITION_ID =
  "ap11.epf-ent-cf-ap11-dev.virementapprovalworkflow.approvalWorkflow";

const WORKFLOW_START_PATH =
  "/workflow/rest/v1/workflow-instances?environmentId=nonprd";

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

  LOG.info(
    "Approval workflow start request completed.",
    JSON.stringify({
      requestId,

      workflowInstanceId:
        response.data.id ||
        response.data.instanceId ||
        response.data.workflowInstanceId ||
        null,

      workflowStatus: response.data.status || null,
    }),
  );

  return response.data;
}

module.exports = {
  startApprovalWorkflow,
  getProcessAutomationDestination,
  getDestinationProperty,
};
