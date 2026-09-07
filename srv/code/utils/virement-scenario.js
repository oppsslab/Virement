"use strict";

/**
 * Classifies a Non-Project Virement request's approval scenario from
 * its request items - each already carrying costCentre, glGroup,
 * department, region, branch, and functionalDepartment, auto-derived
 * per line item (see requestitems-drafts-before-create/update-logic.js)
 * - per the Virement (Non-Project) approval routing table.
 *
 * Priority order (first match wins), matching the table's row order:
 *   1. Different GL Group (transfer-out vs transfer-in) -> Head of
 *      Transfer-out Cost Center (one PER TRANSFER-OUT LINE ITEM, as
 *      its own parallel sub-level - "1A" for line 1, "1B" for line 2,
 *      etc., since each Head approves their own cost center's slice
 *      independently) -> Head of JKEW -> CEO/CFO
 *   2. Same GL Group AND same Cost Centre ("Same Fund Center") ->
 *      Head of Department
 *   3. Same GL Group AND same Branch -> Head of Branch
 *   4. Same GL Group AND same Region (different Branch) -> Head of
 *      Transfer-out Cost Center (per line item, as above) -> Regional
 *      Director
 *   5. Same GL Group AND a single Functional Department covers every
 *      item -> Head of Functional Department
 *   6. Otherwise ("relationship criteria not met") -> Head of
 *      Transfer-out Cost Center (per line item, as above) -> JKEW
 *      Officer PG14/19/21 or Head of JKEW, tiered by total Transfer
 *      Out Amount (same bands as Return requests)
 *
 * "Same X" is evaluated across ALL transfer-out and transfer-in items
 * together: every item must share the exact same value for X.
 *
 * Whenever Level 1 is "Head of Transfer-out Cost Center", it is
 * resolved once PER TRANSFER-OUT LINE ITEM (in item order: line 1 ->
 * level "1A", line 2 -> "1B", ... up to "1E" for the 5th, matching the
 * existing 1-5 Transfer Out item limit), each scoped to that line's
 * own costCentre via the Approver Matrix's departmentBranch column.
 * These are independent parallel approvals, not redundant alternates:
 * approve-reject-request.js's "wait for every sibling at this level
 * before advancing" behavior (originally written for lettered level-2
 * sub-approvers) applies identically here.
 *
 * Simplifications, since the source data doesn't yet support more:
 *   - "authorized functional department cost center" only checks that
 *     every item's GL Account resolves to the SAME Functional
 *     Department (via GL Grouping) - it does not additionally parse
 *     Functional Department Grouping's free-text Fund Centre Scope
 *     column against the actual cost centers used.
 *   - "Head of Transfer-out Cost Center (need to be limit)" - no
 *     amount ceiling is modeled for this role; it approves regardless
 *     of amount, same as everywhere else it appears in the table.
 */

const REQUEST_TYPE_TRANSFER = "T";
const BUDGET_TYPE_NON_PROJECT = "N";

const LEVEL_1_LETTERS = ["A", "B", "C", "D", "E"];

function distinctValues(items, field) {
  const values = new Set();

  for (const item of items) {
    const value = item[field];

    if (value !== null && value !== undefined && String(value).trim() !== "") {
      values.add(String(value).trim());
    }
  }

  return values;
}

/**
 * Builds the Level 1 plan entries for "Head of Transfer-out Cost
 * Center", per transfer-out line item order.
 *
 * @param {object[]} transferOutItems
 * @returns {{level: string, userRole: string, departmentBranch: string}[]}
 */
function buildTransferOutCostCentreEntries(transferOutItems) {
  return transferOutItems.map((item, index) => ({
    level: `1${LEVEL_1_LETTERS[index] || index + 1}`,
    userRole: "HOD_XFER_CC",
    departmentBranch: String(item.costCentre || "").trim(),
  }));
}

/**
 * Builds the single, non-lettered Level 1 plan entry for scenarios
 * resolved by one flat role (Head of Department/Branch/Functional
 * Department) rather than per transfer-out cost center.
 *
 * @param {string} userRole
 * @returns {{level: string, userRole: string}[]}
 */
function buildSingleLevel1Entry(userRole) {
  return [{ level: "1", userRole }];
}

/**
 * Resolves the JKEW Officer / Head of JKEW role for the amount-tiered
 * fallback, using the same bands as Return requests.
 *
 * @param {number} amount
 * @returns {string} UserRoles code
 */
function resolveAmountTierRole(amount) {
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
 * @param {object[]} items - RequestItems rows: costCentre, glGroup,
 *   department, region, branch, functionalDepartment,
 *   transferInAmount, transferOutAmount
 * @returns {object|null} the approval plan classification, or null if
 *   items don't look like a Virement request with both transfer-out
 *   and transfer-in items
 */
function classifyVirementNonProjectScenario(items) {
  const transferOutItems = (items || []).filter(
    (item) => Number(item.transferOutAmount) > 0,
  );

  const transferInItems = (items || []).filter(
    (item) => Number(item.transferInAmount) > 0,
  );

  if (!transferOutItems.length || !transferInItems.length) {
    return null;
  }

  const allItems = [...transferOutItems, ...transferInItems];

  const totalTransferOutAmount = transferOutItems.reduce(
    (sum, item) => sum + (Number(item.transferOutAmount) || 0),
    0,
  );

  const isSameGLGroup = distinctValues(allItems, "glGroup").size === 1;

  if (!isSameGLGroup) {
    return {
      scenario: "Different GL Group",
      level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
      level2Role: "HOD_JKEW",
      level3Role: "CEO_CFO",
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "costCentre").size === 1) {
    return {
      scenario: "Same Fund Center",
      level1Entries: buildSingleLevel1Entry("HOD"),
      level2Role: null,
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "branch").size === 1) {
    return {
      scenario: "Same Branch",
      level1Entries: buildSingleLevel1Entry("HOB"),
      level2Role: null,
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "region").size === 1) {
    return {
      scenario: "Same Region, Different Branch",
      level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
      level2Role: "REG_DIR",
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "functionalDepartment").size === 1) {
    return {
      scenario: "Authorized Functional Department",
      level1Entries: buildSingleLevel1Entry("HOD_FUNC"),
      level2Role: null,
      totalTransferOutAmount,
    };
  }

  return {
    scenario: "Relationship criteria not met (amount-tiered)",
    level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
    level2Role: resolveAmountTierRole(totalTransferOutAmount),
    totalTransferOutAmount,
  };
}

module.exports = {
  classifyVirementNonProjectScenario,
  REQUEST_TYPE_TRANSFER,
  BUDGET_TYPE_NON_PROJECT,
};
