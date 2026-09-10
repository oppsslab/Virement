"use strict";

const cds = require("@sap/cds");

const LOG = cds.log("virement-scenario");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Classifies a Non-Project Virement request's approval scenario from
 * its request items - each already carrying costCentre, glGroup,
 * department, region, branch, and functionalDepartment, auto-derived
 * per line item (see requestitems-drafts-before-create/update-logic.js)
 * - per the Virement (Non-Project) approval routing table.
 *
 * Priority order (first match wins), matching the table's row order:
 *   0. Functional Department Grouping match (see
 *      classifyByFunctionalDepartmentGrouping below) -> Head of
 *      Functional Department. Checked BEFORE everything else below -
 *      if it doesn't pass, falls through to the unchanged chain
 *      starting at 1, including that chain's own (looser) Functional
 *      Department scenario at 5.
 *   1. Different GL Group (transfer-out vs transfer-in) -> Head of
 *      Transfer-out Cost Center (one PER TRANSFER-OUT LINE ITEM, as
 *      its own parallel sub-level - "1A" for line 1, "1B" for line 2,
 *      etc., since each Head approves their own cost center's slice
 *      independently) -> Head of JKEW -> CEO/CFO
 *   2. Same GL Group AND same Department ("Same Department") ->
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
 * The one shared value a distinctValues(...).size === 1 check already
 * confirmed every item has for the given field.
 *
 * @param {object[]} items
 * @param {string} field
 * @returns {string}
 */
function singleValue(items, field) {
  return [...distinctValues(items, field)][0];
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
 * Department) rather than per transfer-out cost center - scoped to
 * the shared Department/Branch/Functional Department value every item
 * matched on, so resolveApprovers (see get-approvers-logic.js) only
 * returns the Approver Matrix row for THAT department/branch/etc,
 * rather than every current approver for the role across all of them.
 *
 * @param {string} userRole
 * @param {string} departmentBranch - the single shared value (e.g.
 *   distinctValues(allItems, "department")'s one member) items were
 *   matched on for this scenario
 * @returns {{level: string, userRole: string, departmentBranch: string}[]}
 */
function buildSingleLevel1Entry(userRole, departmentBranch) {
  return [{ level: "1", userRole, departmentBranch }];
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

function hasText(value) {
  return String(value ?? "").trim() !== "";
}

/**
 * Priority-0 check: every item (transfer-out and transfer-in alike)
 * must resolve, via its own GL Account, to the SAME Functional
 * Department Grouping row - functionalDepartment is already
 * auto-derived per item from that row's GL Accounts list (see
 * utils/functional-department-grouping-lookup.js), so this is a plain
 * equality check across all items, no extra GL lookup needed here.
 *
 * If that holds, EVERY Transfer In item's own Department / Region &
 * Branch attributes (computed directly from its department/region/
 * branch fields, the same way service.cds's isDepartment/
 * isRegionAndBranch calculated columns do - not read from those
 * columns themselves, since they are populated only by a live OData
 * read and are not reliably present on a plain deep-insert payload
 * item) must satisfy whichever of the matched row's isDepartment/
 * isRegionAndBranch checkboxes are set - an OR across whichever of
 * the two are checked, so a row with only one checked requires just
 * that one to match (on every Transfer In item, not just one of
 * them), and a row with neither checked can never pass this
 * validation.
 *
 * @param {object} tx - an active cds.tx()
 * @param {object[]} transferOutItems
 * @param {object[]} transferInItems - 1 to 5 items (enforced at
 *   submission - see requests-before-create-logic.js's
 *   validateVirementItemCounts)
 * @returns {Promise<object|null>} the classification, or null if
 *   either validation fails - the caller then falls through to this
 *   file's own (unchanged, looser) scenario chain
 */
async function classifyByFunctionalDepartmentGrouping(
  tx,
  transferOutItems,
  transferInItems,
) {
  const allItems = [...transferOutItems, ...transferInItems];

  const everyItemHasFunctionalDepartment = allItems.every((item) =>
    hasText(item.functionalDepartment),
  );

  if (!everyItemHasFunctionalDepartment) {
    return null;
  }

  if (distinctValues(allItems, "functionalDepartment").size !== 1) {
    return null;
  }

  if (!transferInItems.length) {
    return null;
  }

  const functionalDepartment = singleValue(allItems, "functionalDepartment");

  const { FunctionalDepartmentGrouping } = cds.entities(SERVICE_NAMESPACE);

  const groupingRow = await tx.run(
    SELECT.one
      .from(FunctionalDepartmentGrouping)
      .columns("isDepartment", "isRegionAndBranch")
      .where({ functionalDepartment }),
  );

  if (!groupingRow) {
    LOG.warn(
      "Functional Department matched on every item, but no " +
        "Functional Department Grouping master row was found for it " +
        "(deleted since?). Falling through to the standard scenario " +
        "chain.",
      JSON.stringify({ functionalDepartment }),
    );

    return null;
  }

  const transferInIsDepartment = transferInItems.every((item) =>
    hasText(item.department),
  );
  const transferInIsRegionAndBranch = transferInItems.every(
    (item) => hasText(item.region) && hasText(item.branch),
  );

  const secondValidationPassed =
    (groupingRow.isDepartment && transferInIsDepartment) ||
    (groupingRow.isRegionAndBranch && transferInIsRegionAndBranch);

  if (!secondValidationPassed) {
    return null;
  }

  const totalTransferOutAmount = transferOutItems.reduce(
    (sum, item) => sum + (Number(item.transferOutAmount) || 0),
    0,
  );

  return {
    scenario: "Functional Department Grouping match",
    level1Entries: buildSingleLevel1Entry("HOD_FUNC", functionalDepartment),
    level2Role: null,
    totalTransferOutAmount,
  };
}

/**
 * @param {object} tx - an active cds.tx(), needed to look up
 *   Functional Department Grouping master data for the priority-0
 *   check (see classifyByFunctionalDepartmentGrouping above)
 * @param {object[]} items - RequestItems rows: costCentre, glGroup,
 *   department, region, branch, functionalDepartment,
 *   transferInAmount, transferOutAmount
 * @returns {Promise<object|null>} the approval plan classification, or
 *   null if items don't look like a Virement request with both
 *   transfer-out and transfer-in items
 */
async function classifyVirementNonProjectScenario(tx, items) {
  const transferOutItems = (items || []).filter(
    (item) => Number(item.transferOutAmount) > 0,
  );

  const transferInItems = (items || []).filter(
    (item) => Number(item.transferInAmount) > 0,
  );

  if (!transferOutItems.length || !transferInItems.length) {
    LOG.info(
      "Not yet classifiable - missing a transfer-out or transfer-in " +
        "item.",
      JSON.stringify({
        transferOutCount: transferOutItems.length,
        transferInCount: transferInItems.length,
      }),
    );

    return null;
  }

  const allItems = [...transferOutItems, ...transferInItems];

  const totalTransferOutAmount = transferOutItems.reduce(
    (sum, item) => sum + (Number(item.transferOutAmount) || 0),
    0,
  );

  /*
   * Logged unconditionally (not just on the fallback branch) so a
   * mismatch is visible even when the classification looks right at
   * a glance in the UI - e.g. two rows showing the same Department
   * text that are actually different underlying values (trailing
   * whitespace survives the Set dedup below via trim(), but a case or
   * genuinely different Department Grouping master-data value would
   * not).
   */
  LOG.info(
    "Classifying scenario from items:",
    JSON.stringify(
      allItems.map((item) => ({
        costCentre: item.costCentre,
        glGroup: item.glGroup,
        department: item.department,
        region: item.region,
        branch: item.branch,
        functionalDepartment: item.functionalDepartment,
        transferOutAmount: item.transferOutAmount,
        transferInAmount: item.transferInAmount,
      })),
    ),
  );

  const functionalDepartmentGroupingMatch =
    await classifyByFunctionalDepartmentGrouping(
      tx,
      transferOutItems,
      transferInItems,
    );

  if (functionalDepartmentGroupingMatch) {
    return functionalDepartmentGroupingMatch;
  }

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

  if (distinctValues(allItems, "department").size === 1) {
    return {
      scenario: "Same Department",
      level1Entries: buildSingleLevel1Entry(
        "HOD",
        singleValue(allItems, "department"),
      ),
      level2Role: null,
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "branch").size === 1) {
    return {
      scenario: "Same Branch",
      level1Entries: buildSingleLevel1Entry(
        "HOB",
        singleValue(allItems, "branch"),
      ),
      level2Role: null,
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "region").size === 1) {
    return {
      scenario: "Same Region, Different Branch",
      level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
      level2Role: "REG_DIR",
      level2DepartmentBranch: singleValue(allItems, "region"),
      totalTransferOutAmount,
    };
  }

  if (distinctValues(allItems, "functionalDepartment").size === 1) {
    return {
      scenario: "Authorized Functional Department",
      level1Entries: buildSingleLevel1Entry(
        "HOD_FUNC",
        singleValue(allItems, "functionalDepartment"),
      ),
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
