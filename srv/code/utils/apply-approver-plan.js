"use strict";

const cds = require("@sap/cds");

const { resolveApprovalPlan, getManagedLevels } = require("./approver-routing");

const { resolveApprovers } = require("../get-approvers-logic");

const { APPROVER_STATUS, REQUEST_STATUS } = require("./request-status");

const LOG = cds.log("apply-approver-plan");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Resolves and (re-)persists the CAP-owned approval plan for a
 * request, into whichever RequestApprovers target the caller passes
 * (the plain active entity, or RequestApprovers.drafts for a draft in
 * progress).
 *
 * Every level this (requestType, budgetType) combo could EVER resolve
 * to (see getManagedLevels) is cleared before inserting the current
 * plan - not just the levels the current plan happens to use - so a
 * stale level from an earlier, now-superseded classification (e.g. a
 * Virement whose items' glGroup/department populated asynchronously
 * and briefly classified differently) never lingers alongside the
 * current one. Safe to call repeatedly, e.g. on every "Calculate"
 * click, without accumulating duplicates. Rows for OTHER levels (still
 * resolved by SAP Build's own decision tables, for a different
 * request type/budget type combo) are left completely alone.
 *
 * A request whose (requestType, budgetType) has no CAP-owned rule at
 * all (getManagedLevels returns []) is a deliberate no-op: nothing is
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
  const managedLevels = getManagedLevels({ requestTypeCode, budgetTypeCode });

  if (!managedLevels.length) {
    return [];
  }

  await tx.run(
    DELETE.from(RequestApproversTarget).where({
      request_ID: requestId,
      level: { in: managedLevels },
    }),
  );

  const plan = await resolveApprovalPlan({
    tx,
    requestTypeCode,
    budgetTypeCode,
    amount,
    items,
  });

  if (!plan.length) {
    return [];
  }

  const applied = [];

  for (const { level, userRole, departmentBranch } of plan) {
    const approvers = await resolveApprovers({ tx, userRole, departmentBranch });

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

  /*
   * This preview mirror only makes sense before first submission -
   * Edit is also allowed again once a request is Pending Approval
   * (to change Reason/Asset Status only, see annotations.cds), and
   * an item or header field changing during THAT edit must not
   * touch RequestApprovers.drafts: the real approvers are already
   * assigned and mid-approval, and overwriting this preview mirror
   * risks it being carried into the active RequestApprovers rows on
   * save, silently resetting genuine approval progress.
   */
  if (draftRequest.status_code !== REQUEST_STATUS.DRAFT) {
    LOG.info(
      "Request is not in Draft status - skipping approver preview " +
        "refresh (editing an already-submitted request touches only " +
        "Reason/Asset Status, never routing).",
      JSON.stringify({ requestId, status_code: draftRequest.status_code }),
    );

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
          "responsibleCostCentre",
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

/**
 * Read-only preview of which CAP-owned approval-plan levels would
 * resolve to ZERO current Approver Matrix approvers - without
 * persisting anything. Used at actual submission time (see
 * requests-before-create-logic.js) to warn the requestor: a level
 * with no matching approver is otherwise silently skipped once
 * applyApproverPlan actually runs (see above), leaving the request
 * stuck with an incomplete approval chain and no visible sign why.
 *
 * @param {object} options
 * @param {object} options.tx - an active cds.tx()
 * @param {string} options.requestTypeCode
 * @param {string} options.budgetTypeCode
 * @param {number|string} [options.amount]
 * @param {object[]} [options.items]
 * @returns {Promise<{level: string, userRole: string, departmentBranch?: string}[]>}
 *   the levels that resolved to zero approvers, if any
 */
async function previewApprovalPlanGaps({
  tx,
  requestTypeCode,
  budgetTypeCode,
  amount,
  items,
}) {
  const plan = await resolveApprovalPlan({
    tx,
    requestTypeCode,
    budgetTypeCode,
    amount,
    items,
  });

  const gaps = [];

  for (const { level, userRole, departmentBranch } of plan) {
    const approvers = await resolveApprovers({ tx, userRole, departmentBranch });

    if (!approvers.length) {
      gaps.push({ level, userRole, departmentBranch });
    }
  }

  return gaps;
}

/**
 * Read-only resolution of the CAP-owned approval plan's levels
 * together with the actual Approver Matrix emails each level
 * currently resolves to - without persisting anything. Used at actual
 * submission time (see requests-before-create-logic.js) for the
 * same-person conflict checks (Level 1 vs Level 2, Requestor vs any
 * approver), which need real identities to compare, unlike
 * previewApprovalPlanGaps above which only cares whether a level
 * resolved to zero approvers.
 *
 * @param {object} options
 * @param {object} options.tx - an active cds.tx()
 * @param {string} options.requestTypeCode
 * @param {string} options.budgetTypeCode
 * @param {number|string} [options.amount]
 * @param {object[]} [options.items]
 * @returns {Promise<{level: string, userRole: string, departmentBranch?: string, emails: string[]}[]>}
 */
async function resolveApprovalPlanWithApprovers({
  tx,
  requestTypeCode,
  budgetTypeCode,
  amount,
  items,
}) {
  const plan = await resolveApprovalPlan({
    tx,
    requestTypeCode,
    budgetTypeCode,
    amount,
    items,
  });

  const resolved = [];

  for (const { level, userRole, departmentBranch } of plan) {
    const approvers = await resolveApprovers({ tx, userRole, departmentBranch });

    resolved.push({
      level,
      userRole,
      departmentBranch,
      emails: approvers.map((approver) => approver.emailAddress),
    });
  }

  return resolved;
}

module.exports = {
  applyApproverPlan,
  resolveApprovalAmount,
  refreshDraftApproverPreview,
  resolveApprovalPlanWithApprovers,
  previewApprovalPlanGaps,
};
