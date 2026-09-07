"use strict";

const cds = require("@sap/cds");

const { resolveApprovalPlan } = require("./approver-routing");

const { resolveApprovers } = require("../get-approvers-logic");

const { APPROVER_STATUS } = require("./request-status");

const LOG = cds.log("apply-approver-plan");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Resolves and (re-)persists the CAP-owned approval plan for a
 * request, into whichever RequestApprovers target the caller passes
 * (the plain active entity, or RequestApprovers.drafts for a draft in
 * progress).
 *
 * Only levels this plan actually covers are touched: existing rows
 * for those levels are cleared and replaced every call (safe to call
 * repeatedly, e.g. on every "Calculate" click, without accumulating
 * duplicates), but rows for OTHER levels (still resolved by SAP
 * Build's own decision tables) are left completely alone.
 *
 * A request whose (requestType, budgetType) has no CAP-owned rule
 * (resolveApprovalPlan returns []) is a deliberate no-op: nothing is
 * touched, and SAP Build's workflow remains solely responsible for
 * it, same as before this feature existed.
 *
 * @param {object} options
 * @param {object} options.tx - an active cds.tx()
 * @param {object} options.RequestApproversTarget - the RequestApprovers
 *   entity to read/write (active projection, or RequestApprovers.drafts)
 * @param {string} options.requestId
 * @param {string} options.requestTypeCode
 * @param {string} options.budgetTypeCode
 * @param {number|string} [options.amount] - the amount relevant to
 *   this request type (e.g. returnAmount for Return requests), for
 *   rules whose approver depends on the amount. Ignored by rules that
 *   don't need it.
 * @param {object[]} [options.items] - RequestItems rows, required for
 *   Virement (Transfer) requests - see utils/virement-scenario.js.
 *   Ignored by rules that don't need it.
 * @param {string} [options.draftUUID] - the parent draft row's own
 *   DraftAdministrativeData_DraftUUID. Required when
 *   RequestApproversTarget is RequestApprovers.drafts: unlike a normal
 *   Fiori-initiated child-draft CREATE (where CAP's generic draft
 *   handlers fill this in automatically before any custom handler
 *   runs), this function inserts directly via tx.run(), bypassing
 *   that generic handling, so IsActiveEntity and
 *   DraftAdministrativeData_DraftUUID must be set explicitly here to
 *   correctly link each inserted row to the in-progress draft.
 * @returns {Promise<{level: string, userRole: string, emails: string[]}[]>}
 *   the levels actually (re-)populated, for history/logging
 */
async function applyApproverPlan({
  tx,
  RequestApproversTarget,
  requestId,
  requestTypeCode,
  budgetTypeCode,
  amount,
  items,
  draftUUID,
}) {
  const plan = resolveApprovalPlan({ requestTypeCode, budgetTypeCode, amount, items });

  if (!plan.length) {
    return [];
  }

  const applied = [];

  for (const { level, userRole, departmentBranch } of plan) {
    const approvers = await resolveApprovers({ tx, userRole, departmentBranch });

    await tx.run(
      DELETE.from(RequestApproversTarget).where({
        request_ID: requestId,
        level,
      }),
    );

    if (!approvers.length) {
      LOG.warn(
        "CAP-owned approval rule matched, but no current Approver " +
          "Matrix approver was found for the role.",
        JSON.stringify({ requestId, level, userRole, departmentBranch }),
      );

      continue;
    }

    /*
     * A draft row is only a preview - no approval has actually started,
     * so its Status is left empty (null) rather than "Pending Approval".
     * Only the real submission (no draftUUID, i.e. the active
     * RequestApprovers table) sets a real status.
     *
     * A level "starts with 1" test (not "=== '1'") so lettered
     * parallel sub-levels ("1A", "1B", ...) - independent
     * transfer-out-cost-center approvers for Virement - are ALL
     * correctly seeded as Pending Approval too, not just a literal
     * level "1".
     */
    const rows = approvers.map((approver) => ({
      request_ID: requestId,
      emailAddress: approver.emailAddress,
      userRole: approver.userRole,
      level,
      status_code: draftUUID
        ? null
        : level.startsWith("1")
          ? APPROVER_STATUS.PENDING_APPROVAL
          : APPROVER_STATUS.INACTIVE,
      ...(draftUUID
        ? {
            IsActiveEntity: false,
            DraftAdministrativeData_DraftUUID: draftUUID,
          }
        : {}),
    }));

    await tx.run(INSERT.into(RequestApproversTarget).entries(rows));

    LOG.info(
      "CAP-owned approval plan applied.",
      JSON.stringify({
        requestId,
        level,
        userRole,
        emails: rows.map((row) => row.emailAddress),
      }),
    );

    applied.push({
      level,
      userRole,
      emails: rows.map((row) => row.emailAddress),
    });
  }

  return applied;
}

/**
 * Picks the amount field relevant to approver routing for a given
 * request type, out of an amounts-shaped object - e.g. the return
 * value of calculateAmountsByType/recalcAmountsByType, or a Requests
 * row itself (same field names: supplementAmount, returnAmount,
 * transferInAmount, transferOutAmount).
 *
 * @param {string} requestTypeCode
 * @param {object} amounts
 * @returns {number|string|undefined}
 */
function resolveApprovalAmount(requestTypeCode, amounts) {
  const type = String(requestTypeCode || "").trim().toUpperCase();

  if (type === "S") {
    return amounts?.supplementAmount;
  }

  if (type === "R") {
    return amounts?.returnAmount;
  }

  return amounts?.transferOutAmount;
}

/**
 * Convenience wrapper for the automatic (Calculate-free) triggers:
 * reads the parent draft Requests row's own classification
 * (requestType_code, budgetType_code, DraftAdministrativeData_DraftUUID)
 * and applies the CAP-owned approver plan against RequestApprovers.drafts.
 *
 * Used wherever the approver preview must refresh without the user
 * pressing Calculate: after a draft RequestItems row is created or
 * updated (the amount changed), and after the draft Requests header's
 * own requestType_code/budgetType_code changes directly.
 *
 * @param {object} options
 * @param {object} options.tx - an active cds.tx()
 * @param {object} options.RequestsDraft - the Requests.drafts entity
 * @param {object} options.RequestApproversDraft - the
 *   RequestApprovers.drafts entity
 * @param {string} options.requestId
 * @param {object} [options.amounts] - amounts-shaped object to pick
 *   the routing amount from (see resolveApprovalAmount); defaults to
 *   the draft Requests row's own stored totals, which is correct
 *   whenever the caller hasn't just recalculated fresher ones itself
 * @returns {Promise<{level: string, userRole: string, emails: string[]}[]>}
 */
async function refreshDraftApproverPreview({
  tx,
  RequestsDraft,
  RequestApproversDraft,
  requestId,
  amounts,
}) {
  const draftRequest = await tx.run(
    SELECT.one.from(RequestsDraft).where({ ID: requestId }),
  );

  if (!draftRequest) {
    return [];
  }

  const requestTypeCode = draftRequest.requestType_code;

  let items;

  if (String(requestTypeCode || "").trim().toUpperCase() === "T") {
    const { RequestItems } = cds.entities(SERVICE_NAMESPACE);

    items = await tx.run(
      SELECT.from(RequestItems.drafts)
        .columns(
          "costCentre",
          "glGroup",
          "department",
          "region",
          "branch",
          "functionalDepartment",
          "transferInAmount",
          "transferOutAmount",
        )
        .where({ request_ID: requestId })
        .orderBy("srNo"),
    );
  }

  return applyApproverPlan({
    tx,
    RequestApproversTarget: RequestApproversDraft,
    requestId,
    requestTypeCode,
    budgetTypeCode: draftRequest.budgetType_code,
    amount: resolveApprovalAmount(requestTypeCode, amounts || draftRequest),
    items,
    draftUUID: draftRequest.DraftAdministrativeData_DraftUUID,
  });
}

module.exports = {
  applyApproverPlan,
  resolveApprovalAmount,
  refreshDraftApproverPreview,
};
