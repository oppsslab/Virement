"use strict";

const cds = require("@sap/cds");

const { getWorkflowInstanceExecutionLogs } = require("./utils/workflow-utils");

const LOG = cds.log("workflow-logs-read-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const DEFAULT_PAGE_SIZE = 100;

/**
 * Extracts $top/$skip from the incoming CQN SELECT, mirroring
 * utils/value-help.js's extractPaging. SAP Build's execution-logs
 * endpoint returns the whole log in one call every time (it does not
 * support server-side paging itself), so this app has to slice the
 * page UI5 actually asked for - returning the full array unsliced on
 * every request duplicates entries once a table scrolls past the
 * first page, since each page would restart from the same row 0 with
 * the same keys, confusing the table's row virtualization (surfaced
 * as "The object with ID ... was destroyed and cannot be used
 * anymore").
 *
 * @param {object} select - request.query.SELECT
 * @returns {{top: number, skip: number}}
 */
function extractPaging(select) {
  const limit = (select && select.limit) || {};

  const requested = Number(limit.rows && limit.rows.val);

  const offset = Number(limit.offset && limit.offset.val);

  return {
    top: requested > 0 ? requested : DEFAULT_PAGE_SIZE,
    skip: offset > 0 ? offset : 0,
  };
}

/**
 * Serves WorkflowLogs, read live from SAP Build Process Automation
 * rather than persisted. Reached only via the WorkflowLogs
 * association on Requests (see service.cds).
 *
 * WorkflowLogs is a @cds.persistence.skip entity, so unlike a
 * genuine DB-to-DB association, CAP does not (and cannot) translate
 * the navigation "/Requests(ID=...)/WorkflowLogs" into an equivalent
 * $filter/where on workflowInstanceId - there is no real table to
 * correlate against. The incoming query has no where-clause at all;
 * confirmed via the logged OData request, which carries only
 * $select/$skip/$top. request.params instead carries the parent
 * Requests row's own key (the navigation path segment), which is
 * used here to look up that Request's workflowInstanceId directly.
 *
 * @param {cds.Request} request
 * @returns {Promise<object[]>}
 */
module.exports = async function readWorkflowLogs(request) {
  const parentKey = request.params?.[0];

  if (!parentKey || !parentKey.ID) {
    LOG.warn("WorkflowLogs read without a parent Requests key.");

    return [];
  }

  const tx = cds.tx(request);

  const { Requests } = cds.entities(SERVICE_NAMESPACE);

  const parentRequest = await tx.run(
    SELECT.one
      .from(Requests)
      .columns("workflowInstanceId")
      .where({ ID: parentKey.ID }),
  );

  const workflowInstanceId = parentRequest?.workflowInstanceId;

  if (!workflowInstanceId) {
    LOG.warn(
      "Parent Request has no workflowInstanceId yet.",
      JSON.stringify({ requestId: parentKey.ID }),
    );

    return [];
  }

  const allEntries = await getWorkflowInstanceExecutionLogs(workflowInstanceId);

  const select = (request.query && request.query.SELECT) || {};

  const { top, skip } = extractPaging(select);

  const page = allEntries.slice(skip, skip + top);

  /*
   * CAP's documented convention for a custom READ handler to report
   * $count: attach it directly to the returned array.
   */
  page.$count = allEntries.length;

  return page;
};
