const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");

const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("pending-approver-decision");

const DESTINATION_NAME = "sap_process_automation_service";
const DECISION_PATH = "/public/rule/runtime/rest/v2/rule-services";
const ENVIRONMENT_ID = "nonprd";
const RULE_SERVICE_ID = "60a52fe3d83c8f4757329ff886d3d805";

/**
 * Reads a custom property from a resolved SAP Cloud SDK destination.
 *
 * Depending on the SDK version, custom destination properties may be
 * exposed directly on the destination, under originalProperties, or under
 * originalProperties.destinationConfiguration.
 *
 * @param {object} destination
 * @param {string[]} propertyNames
 * @returns {string|null}
 */
function getDestinationProperty(destination, propertyNames) {
  const originalProperties = destination?.originalProperties || {};
  const destinationConfiguration =
    originalProperties.destinationConfiguration || {};

  const propertyContainers = [
    destination,
    originalProperties,
    destinationConfiguration,
  ];

  for (const container of propertyContainers) {
    if (!container || typeof container !== "object") {
      continue;
    }

    for (const propertyName of propertyNames) {
      const exactValue = container[propertyName];

      if (
        exactValue !== undefined &&
        exactValue !== null &&
        String(exactValue).trim()
      ) {
        return String(exactValue).trim();
      }

      const matchingKey = Object.keys(container).find(function (key) {
        return (
          String(key).trim().toLowerCase() ===
          String(propertyName).trim().toLowerCase()
        );
      });

      if (matchingKey) {
        const matchingValue = container[matchingKey];

        if (
          matchingValue !== undefined &&
          matchingValue !== null &&
          String(matchingValue).trim()
        ) {
          return String(matchingValue).trim();
        }
      }
    }
  }

  return null;
}

/**
 * Extracts the pending approver from the decision response.
 *
 * Add or change the output property names below if the deployed decision
 * uses a different output column name.
 *
 * @param {object} responseData
 * @returns {string|null}
 */
function extractPendingApprover(responseData) {
  const resultRows =
    responseData?.Result ||
    responseData?.result ||
    responseData?.Results ||
    responseData?.results;

  const firstResult = Array.isArray(resultRows) ? resultRows[0] : resultRows;

  if (!firstResult || typeof firstResult !== "object") {
    return null;
  }

  const pendingApprover =
    firstResult.Pending_Approver ||
    firstResult.pendingApprover ||
    firstResult.PendingApprover ||
    firstResult.Approver ||
    firstResult.approver;

  if (pendingApprover === undefined || pendingApprover === null) {
    return null;
  }

  const normalizedApprover = String(pendingApprover).trim();

  return normalizedApprover || null;
}

/**
 * Retrieves the Process Automation destination and reads its API key.
 *
 * The destination should contain one of these additional properties:
 * - apiKey
 * - api-key
 * - URL.headers.api-key
 *
 * @returns {Promise<{destination: object, apiKey: string}>}
 */
async function getProcessAutomationDestination() {
  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
    useCache: false,
  });

  if (!destination) {
    const error = new Error(`Destination '${DESTINATION_NAME}' was not found.`);

    error.statusCode = 503;
    throw error;
  }

  const originalProperties = destination.originalProperties || {};
  const destinationConfiguration =
    originalProperties.destinationConfiguration || {};

  /*
   * Log property names only. Do not log the complete destination,
   * API key, client secret, or authentication tokens.
   */
  LOG.info(
    "Process Automation destination retrieved.",
    JSON.stringify({
      name: destination.name || DESTINATION_NAME,
      url: destination.url,
      authentication: destination.authentication,
      proxyType: destination.proxyType,
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
    "URL.headers.api-key",
  ]);

  if (!apiKey) {
    LOG.error(
      "API key was not available in the retrieved destination.",
      JSON.stringify({
        destination: DESTINATION_NAME,
        originalPropertyNames: Object.keys(originalProperties),
        destinationConfigurationPropertyNames: Object.keys(
          destinationConfiguration,
        ),
      }),
    );

    const error = new Error(
      `Destination '${DESTINATION_NAME}' does not expose the custom ` +
        "property 'apiKey' in its destinationConfiguration.",
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
 * Invokes the SAP Build Process Automation decision that determines the
 * pending approver.
 *
 * @param {object} options
 * @param {string} options.requestTypeCode
 * @returns {Promise<string>}
 */
async function determinePendingApprover({ requestTypeCode }) {
  const normalizedRequestType = String(requestTypeCode || "")
    .trim()
    .toUpperCase();

  if (!normalizedRequestType) {
    const error = new Error(
      "Request Type is required to determine the pending approver.",
    );

    error.statusCode = 400;
    throw error;
  }

  const payload = {
    RuleServiceId: RULE_SERVICE_ID,
    Vocabulary: [
      {
        Request_Type: normalizedRequestType,
      },
    ],
  };

  LOG.info(
    "Invoking pending approver decision.",
    JSON.stringify({
      destination: DESTINATION_NAME,
      environmentId: ENVIRONMENT_ID,
      ruleServiceId: RULE_SERVICE_ID,
      requestType: normalizedRequestType,
    }),
  );

  try {
    const { destination, apiKey } = await getProcessAutomationDestination();

    const response = await executeHttpRequest(
      destination,
      {
        method: "POST",
        url: DECISION_PATH,
        params: {
          environmentId: ENVIRONMENT_ID,
        },
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        data: payload,
      },
      {
        fetchCsrfToken: false,
      },
    );

    LOG.info(
      "Pending approver decision completed.",
      JSON.stringify({
        status: response.status,
      }),
    );

    LOG.debug(
      "Pending approver decision response:",
      JSON.stringify(response.data || {}),
    );

    const pendingApprover = extractPendingApprover(response.data);

    if (!pendingApprover) {
      LOG.error(
        "Decision returned no pending approver.",
        JSON.stringify(response.data || {}),
      );

      const error = new Error(
        "No pending approver was returned by the approval decision.",
      );

      error.statusCode = 422;
      throw error;
    }

    return pendingApprover;
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }

    const responseStatus = error.response?.status;
    const responseData = error.response?.data;
    const upstreamMessage = responseData?.error?.message;

    LOG.error(
      "Pending approver decision invocation failed.",
      JSON.stringify({
        status: responseStatus,
        message: error.message,
        upstreamMessage,
        response: responseData,
      }),
    );

    if (responseStatus === 401) {
      const authenticationError = new Error(
        "SAP Process Automation rejected the destination authentication. " +
          "Verify the destination client ID, client secret, and token " +
          "service URL.",
      );

      authenticationError.statusCode = 502;
      authenticationError.cause = error;
      throw authenticationError;
    }

    if (responseStatus === 403) {
      const authorizationError = new Error(
        "SAP Process Automation rejected access to the " +
          `'${ENVIRONMENT_ID}' environment even though the API key was ` +
          "explicitly supplied. Verify that the API key was created for " +
          "this exact environment and contains the scope required by the " +
          "Rule Runtime API.",
      );

      authorizationError.statusCode = 502;
      authorizationError.cause = error;
      throw authorizationError;
    }

    if (responseStatus === 404) {
      const notFoundError = new Error(
        "The Process Automation Rule Runtime endpoint or deployed decision " +
          "was not found. Verify the regional API URL, environment ID, " +
          "deployment, and RuleServiceId.",
      );

      notFoundError.statusCode = 502;
      notFoundError.cause = error;
      throw notFoundError;
    }

    const decisionError = new Error(
      upstreamMessage ||
        "Unable to determine the pending approver from the approval decision.",
    );

    decisionError.statusCode =
      responseStatus >= 400 && responseStatus < 500 ? 502 : 503;

    decisionError.cause = error;
    throw decisionError;
  }
}

module.exports = {
  determinePendingApprover,
  extractPendingApprover,
};
