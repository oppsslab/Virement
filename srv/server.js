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

cds.on("bootstrap", (app) => {
  for (const actionName of ACTIONS_REQUIRING_WORKAROUND) {
    registerActionPathWorkaround(app, actionName);
  }
});
