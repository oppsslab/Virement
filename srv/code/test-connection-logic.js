"use strict";

const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");

const { readCostCenters } = require("./utils/cost-centers");
const { getProcessAutomationDestination } = require("./utils/workflow-utils");
const { getConfigValue } = require("./utils/system-config");

const LOG = cds.log("test-connection-logic");

/*
 * Keyed by configKey (see db/schema.cds's SystemConfiguration rows).
 * Deliberately read-only / side-effect-free: this runs against
 * whatever destination is actually bound in this space, so it must
 * never create, post or start anything real - it reuses the exact
 * helpers the real business logic calls, rather than inventing a
 * separate "ping" request shape.
 */
const TESTERS = {
  S4_DESTINATION_NAME: async () => {
    const name = await getConfigValue("S4_DESTINATION_NAME", "");
    const rows = await readCostCenters("", { top: 1 });

    return `Connected to destination '${name}' - read ${rows.length} cost centre row(s) from S/4.`;
  },

  CPI_DESTINATION_NAME: async () => {
    const name = await getConfigValue("CPI_DESTINATION_NAME", "");
    const destination = await getDestination({ destinationName: name });

    if (!destination) {
      const error = new Error(`Destination '${name}' was not found.`);

      error.statusCode = 502;

      throw error;
    }

    return (
      `Destination '${name}' resolved (authentication: ` +
      `${destination.authentication || "unknown"}). CPI's iFlows are ` +
      "post-only, so this confirms the destination itself but not a " +
      "full round trip - the next real posting will exercise that."
    );
  },

  BPA_DESTINATION_NAME: async () => {
    const name = await getConfigValue("BPA_DESTINATION_NAME", "");

    await getProcessAutomationDestination();

    return `Destination '${name}' resolved and exposes a usable API key.`;
  },

  WORKFLOW_DEFINITION_ID: async () => {
    await getProcessAutomationDestination();

    return (
      "The BPA destination connects. The workflow definition ID itself " +
      "can only be fully verified by actually submitting a request."
    );
  },

  WORKFLOW_ENVIRONMENT_ID: async () => {
    await getProcessAutomationDestination();

    return (
      "The BPA destination connects. The environment ID itself can " +
      "only be fully verified by actually submitting a request."
    );
  },
};

/**
 * @On("testConnection")
 *
 * Runs a read-only connectivity check for the acted-on
 * SystemConfiguration row, using whichever value is currently saved
 * (not an unsaved edit still in the draft) - same save-then-test
 * convention as Email Configuration's Send Test Email.
 *
 * @param {cds.Request} request
 * @returns {Promise<string>}
 */
module.exports = async function testConnection(request) {
  const configKey = request.params?.[0]?.configKey;

  const tester = TESTERS[configKey];

  if (!tester) {
    request.error(
      400,
      `No connection test is defined for "${configKey}".`,
    );

    return;
  }

  try {
    const message = await tester();

    // A plain return value isn't displayed by Fiori Elements - only
    // text that comes back as an OData message (the sap-messages
    // response header) is. request.error() below already produces
    // one for the failure path; this is the success-path equivalent.
    request.info(message);

    return message;
  } catch (error) {
    LOG.error("Connection test failed.", {
      configKey,
      status: error.response?.status || error.statusCode,
      message: error.message,
    });

    request.error(
      502,
      `Connection test failed: ${error.message}`,
    );
  }
};
