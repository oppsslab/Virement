const cds = require("@sap/cds");

const LOG = cds.log("bpa-action-path-workaround");

const SERVICE_NAME = "ZSVC_PPS_VIREMENT";

const SERVICE_BASE_PATH = "/service/ZSVC_PPS_VIREMENT";

/*
 * CONFIRMED PLATFORM BUG:
 *
 * Unbound OData V4 actions exposed by this service (e.g.
 * assignApprovers) are declared with a
 * proper ActionImport, for example:
 *
 *   <ActionImport Name="assignApprovers"
 *                 Action="ZSVC_PPS_VIREMENT.assignApprovers"/>
 *
 * Per the OData V4 spec, unbound actions must be invoked using
 * only the ActionImport name:
 *
 *   POST /service/ZSVC_PPS_VIREMENT/assignApprovers
 *
 * This has been verified as the path SAP Build's own Actions
 * catalog Test tool displays. However, the actual HTTP request
 * both the Test tool and the Process Automation workflow Service
 * Tasks send uses the fully qualified Action type name instead:
 *
 *   POST /service/ZSVC_PPS_VIREMENT/ZSVC_PPS_VIREMENT.assignApprovers
 *
 * This is a bug in SAP Build's OData action connector, not a
 * configuration issue on the CAP or workflow side, since it is
 * reproducible via SAP's own first-party test tool independent of
 * the workflow. Each route below explicitly accepts that malformed
 * path and forwards the request into the real, correctly-defined
 * action, so the existing action logic (in code/*.js) is reused
 * unchanged.
 *
 * Add any future unbound action called from SAP Build /
 * Process Automation to the ACTIONS_REQUIRING_WORKAROUND list
 * below, rather than duplicating this route-registration logic.
 */
const ACTIONS_REQUIRING_WORKAROUND = [
  "assignApprovers",
];

/*
 * The same platform bug applies to unbound FUNCTIONS (e.g.
 * getApprovers, called by SBPA to look up the current Approver
 * Matrix approver for a role): the connector is expected to send
 *
 *   GET /service/ZSVC_PPS_VIREMENT/getApprovers(userRole='...')
 *
 * but sends the fully qualified type name instead:
 *
 *   GET /service/ZSVC_PPS_VIREMENT/ZSVC_PPS_VIREMENT.getApprovers(userRole='...')
 *
 * Functions carry their parameters in the URL itself rather than a
 * POST body, and parentheses are meaningful to Express's own route
 * matching, so this can't reuse registerActionPathWorkaround as-is -
 * see registerFunctionPathWorkaround below.
 *
 * Add any future unbound function called from SAP Build / Process
 * Automation here, rather than duplicating this route-registration
 * logic.
 */
const FUNCTIONS_REQUIRING_WORKAROUND = [
  "getApprovers",
];

/**
 * Registers a single Express route that intercepts the malformed,
 * fully-qualified action path SAP Build's OData connector sends,
 * and forwards the request into the real CAP action of the same
 * name.
 *
 * @param {import("express").Application} app
 * @param {string} actionName
 */
function registerActionPathWorkaround(app, actionName) {
  const workaroundPath = `${SERVICE_BASE_PATH}/${SERVICE_NAME}.${actionName}`;

  app.post(workaroundPath, async (req, res) => {
    LOG.info(
      `Received ${actionName} call via the fully-qualified action ` +
        "path workaround (SAP Build connector bug).",
      JSON.stringify({ body: req.body }),
    );

    try {
      const service = await cds.connect.to(SERVICE_NAME);

      const result = await service.send(actionName, req.body);

      res.status(200).json(result);
    } catch (error) {
      const statusCode = error.statusCode || error.status || 500;

      LOG.error(
        `Error forwarding ${actionName} call:`,
        JSON.stringify({
          message: error.message,
          statusCode,
        }),
      );

      res.status(statusCode).json({
        error: {
          code: String(statusCode),
          message: error.message || `Failed to execute ${actionName}.`,
        },
      });
    }
  });

  LOG.info(
    "Registered workaround route for SAP Build's fully-qualified " +
      "action path bug:",
    workaroundPath,
  );
}

/**
 * Parses an OData V4 function-call parameter list, e.g.
 * "userRole='Head of Department',departmentBranch=null", into a
 * plain object. Handles quoted string values (with '' as an escaped
 * quote, per the OData literal syntax) and an unquoted null literal.
 * Commas inside quoted values are not treated as separators.
 *
 * @param {string} paramString - the text between the call's ( and )
 * @returns {Record<string, string|null>}
 */
function parseODataFunctionParams(paramString) {
  const params = {};

  if (!paramString) {
    return params;
  }

  const parts = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < paramString.length; i++) {
    const ch = paramString[i];

    if (ch === "'") {
      if (inQuotes && paramString[i + 1] === "'") {
        current += "'";
        i++;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  if (current) {
    parts.push(current);
  }

  for (const part of parts) {
    const eqIdx = part.indexOf("=");

    if (eqIdx === -1) {
      continue;
    }

    const key = part.slice(0, eqIdx).trim();
    const rawValue = part.slice(eqIdx + 1).trim();

    params[key] = rawValue.toLowerCase() === "null" ? null : rawValue;
  }

  return params;
}

/**
 * Registers middleware that intercepts the malformed, fully-qualified
 * function path SAP Build's OData connector sends, and forwards the
 * request into the real CAP function of the same name.
 *
 * A plain Express route string can't be used here: OData function
 * calls carry their parameters in parentheses in the URL itself
 * (unlike actions, which take a POST body), and parentheses are
 * meaningful to Express's own route-pattern matching. Matching the
 * malformed prefix manually in a general middleware sidesteps that
 * entirely.
 *
 * @param {import("express").Application} app
 * @param {string} functionName
 */
function registerFunctionPathWorkaround(app, functionName) {
  const workaroundPrefix = `${SERVICE_BASE_PATH}/${SERVICE_NAME}.${functionName}(`;

  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      !req.path.startsWith(workaroundPrefix) ||
      !req.path.endsWith(")")
    ) {
      return next();
    }

    const paramString = req.path.slice(
      workaroundPrefix.length,
      req.path.length - 1,
    );

    const params = parseODataFunctionParams(paramString);

    LOG.info(
      `Received ${functionName} call via the fully-qualified function ` +
        "path workaround (SAP Build connector bug).",
      JSON.stringify({ params }),
    );

    cds
      .connect.to(SERVICE_NAME)
      .then((service) => service.send(functionName, params))
      .then((result) => {
        res.status(200).json({ value: result });
      })
      .catch((error) => {
        const statusCode = error.statusCode || error.status || 500;

        LOG.error(
          `Error forwarding ${functionName} call:`,
          JSON.stringify({
            message: error.message,
            statusCode,
          }),
        );

        res.status(statusCode).json({
          error: {
            code: String(statusCode),
            message: error.message || `Failed to execute ${functionName}.`,
          },
        });
      });
  });

  LOG.info(
    "Registered workaround route for SAP Build's fully-qualified " +
      "function path bug:",
    workaroundPrefix,
  );
}

cds.on("bootstrap", (app) => {
  for (const actionName of ACTIONS_REQUIRING_WORKAROUND) {
    registerActionPathWorkaround(app, actionName);
  }

  for (const functionName of FUNCTIONS_REQUIRING_WORKAROUND) {
    registerFunctionPathWorkaround(app, functionName);
  }
});
