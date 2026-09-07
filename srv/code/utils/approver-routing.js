"use strict";

const {
  classifyVirementNonProjectScenario,
  REQUEST_TYPE_TRANSFER,
  BUDGET_TYPE_NON_PROJECT,
} = require("./virement-scenario");

/**
 * CAP-owned approval routing rules: given a request's classification,
 * decides which Approver Matrix role approves at which level.
 *
 * This intentionally covers ONLY the rules that have been explicitly
 * migrated from SAP Build's own decision tables into CAP. Any
 * combination not listed here returns an empty plan, meaning SAP
 * Build's workflow decision tables remain the source of truth for it
 * - unmigrated rules are not guessed at here.
 *
 * Add new rules as additional entries returned by resolveApprovalPlan
 * as more of SAP Build's decision tables are moved into CAP.
 */

const REQUEST_TYPE_SUPPLEMENT = "S";

const REQUEST_TYPE_RETURN = "R";

/**
 * Return requests (both Project and Non Project budget type): the
 * approver depends on the return amount. Bands are contiguous and
 * non-overlapping - "up to X" is inclusive of X, "above X" is
 * exclusive of X.
 *
 *   < 30,000                    -> JKEW Officer PG14 and above
 *   30,000 - 100,000 (incl.)    -> JKEW Officer PG19 and above
 *   > 100,000 - 500,000 (incl.) -> JKEW Officer PG21 and above
 *   > 500,000                   -> Head of JKEW
 */
function resolveReturnRole(returnAmount) {
  const amount = Number(returnAmount) || 0;

  if (amount < 30000) {
    return "JKEW_PG14";
  }

  if (amount <= 100000) {
    return "JKEW_PG19";
  }

  if (amount <= 500000) {
    return "JKEW_PG21";
  }

  return "HOD_JKEW";
}

/**
 * Resolves the approval plan (which role approves at which level) for
 * a request, based on its request type, budget type, and (for rules
 * that need it) amount.
 *
 * @param {object} options
 * @param {string} options.requestTypeCode
 * @param {string} options.budgetTypeCode - currently unused: both
 *   migrated rules (Supplement, Return) apply the same way regardless
 *   of Project vs Non Project. Kept for rules that may need it later.
 * @param {number|string} [options.amount] - the amount relevant to
 *   this request type (e.g. returnAmount for Return requests).
 *   Ignored by rules that don't need it.
 * @param {object[]} [options.items] - RequestItems rows (costCentre,
 *   glGroup, department, region, branch, functionalDepartment,
 *   transferInAmount, transferOutAmount), required for Virement
 *   (Transfer) requests - see utils/virement-scenario.js. Ignored by
 *   rules that don't need it.
 * @returns {{level: string, userRole: string, departmentBranch?: string}[]}
 *   empty if no CAP-owned rule applies to this combination. A plan can
 *   carry several entries at the same numeric level with different
 *   letter suffixes (e.g. "1A", "1B") - independent parallel
 *   approvers, each scoped to its own departmentBranch, not redundant
 *   alternates for the same approval.
 */
function resolveApprovalPlan({ requestTypeCode, budgetTypeCode, amount, items }) {
  const requestType = String(requestTypeCode || "").trim().toUpperCase();

  const budgetType = String(budgetTypeCode || "").trim().toUpperCase();

  if (requestType === REQUEST_TYPE_SUPPLEMENT) {
    return [{ level: "1", userRole: "JKEW_BCM" }];
  }

  if (requestType === REQUEST_TYPE_RETURN) {
    return [{ level: "1", userRole: resolveReturnRole(amount) }];
  }

  if (
    requestType === REQUEST_TYPE_TRANSFER &&
    budgetType === BUDGET_TYPE_NON_PROJECT
  ) {
    const classification = classifyVirementNonProjectScenario(items || []);

    if (!classification) {
      return [];
    }

    const plan = classification.level1Entries.map(
      ({ level, userRole, departmentBranch }) => ({
        level,
        userRole,
        ...(departmentBranch ? { departmentBranch } : {}),
      }),
    );

    if (classification.level2Role) {
      plan.push({ level: "2", userRole: classification.level2Role });
    }

    if (classification.level3Role) {
      plan.push({ level: "3", userRole: classification.level3Role });
    }

    return plan;
  }

  return [];
}

module.exports = { resolveApprovalPlan };
