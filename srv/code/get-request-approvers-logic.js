"use strict";

const cds = require("@sap/cds");

const LOG = cds.log("get-request-approvers-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Serves getRequestApprovers(requestId, level) for SAP Build Process
 * Automation: the approver email address(es) CAP has already assigned
 * to a request at a given level.
 *
 * For (requestType, budgetType) combinations covered by
 * utils/approver-routing.js, the workflow calls this INSTEAD OF its
 * own decision table + assignApprovers callback - the assignment was
 * already made by CAP, either at submit time (requests-after-create-logic.js)
 * or earlier as a preview while the request was still a draft
 * (requests-drafts-calculateValues-logic.js). For any other
 * combination, this simply returns whatever assignApprovers has
 * persisted so far (normal for the workflow's own decision-table path).
 *
 * @param {cds.Request} request
 * @returns {Promise<{emailAddress: string}[]>}
 */
module.exports = async function getRequestApprovers(request) {
  const { requestId, level } = request.data || {};

  if (!requestId) {
    return request.error(400, "requestId is required.");
  }

  if (!level) {
    return request.error(400, "level is required.");
  }

  const tx = cds.tx(request);

  const { RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  const rows = await tx.run(
    SELECT.from(RequestApprovers)
      .columns("emailAddress")
      .where({ request_ID: requestId, level: String(level) }),
  );

  LOG.info(
    `getRequestApprovers: requestId="${requestId}" level="${level}" -> ${rows.length} approver(s).`,
  );

  return rows.map((row) => ({ emailAddress: row.emailAddress }));
};
