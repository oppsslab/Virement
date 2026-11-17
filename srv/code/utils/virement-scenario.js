"use strict";

const cds = require("@sap/cds");

const {
  splitGlAccounts,
} = require("./functional-department-grouping-lookup");

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
 *   Checked before everything below: every item (transfer-out and
 *   transfer-in alike) shares the exact same Cost Centre -> Head of
 *   Department (the shared cost centre's own Department, via the
 *   Approver Matrix's departmentBranch column, same as scenario 2's
 *   "Same Department" below). This is money moving within one cost
 *   centre (e.g. reclassifying between GL accounts), so that cost
 *   centre's own Head of Department approves it directly - overriding
 *   even a Functional Department Grouping match below, since a
 *   same-cost-centre transfer is a more specific signal than "this GL
 *   Account happens to be flagged as this functional department's".
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
 *   - An item's Department qualifies a matched Functional Department
 *     Grouping row's "Is Department" checkbox (isDepartmentItem) only
 *     when it literally equals that Functional Department's own name
 *     - DepartmentGrouping.department is maintained to match
 *     FunctionalDepartmentGrouping.functionalDepartment exactly for a
 *     functional department that is also a department in its own
 *     right (confirmed against live data). This relies on that naming
 *     convention being followed consistently by whoever maintains both
 *     tables - there is no foreign-key-style reference enforcing it.
 *   - "Head of Transfer-out Cost Center (need to be limit)" - no
 *     amount ceiling is modeled for this role; it approves regardless
 *     of amount, same as everywhere else it appears in the table.
 */

const REQUEST_TYPE_TRANSFER = "T";
const BUDGET_TYPE_NON_PROJECT = "N";
const BUDGET_TYPE_PROJECT = "P";

const LEVEL_1_LETTERS = ["A", "B", "C", "D", "E"];

/*
 * Fund Center + Material Group identifying the Central Fund - the
 * same account the Return-to-Central-Fund balancing line in
 * post-to-s4-logic.js posts into (its own CENTRAL_FUND_COST_CENTRE /
 * CENTRAL_FUND_MATERIAL constants). Hardcoded, per Finance: a
 * Virement whose Transfer Out line moves money OUT of this account is
 * never a normal departmental transfer, so it always routes straight
 * through the JKEW amount-tiered chain (see resolveAmountTierRole
 * below) at Level 1, overriding every other scenario in the chain
 * below - including even the Same Cost Centre check, which would
 * otherwise match whenever every item (Central Fund transfer-out
 * included) shares one cost centre.
 */
const CENTRAL_FUND_COST_CENTRE = "100050500";
const CENTRAL_FUND_MATERIAL = "760001000";

function isCentralFundTransferOutItem(item) {
  return (
    String(item.costCentre ?? "").trim() === CENTRAL_FUND_COST_CENTRE &&
    String(item.material ?? "").trim() === CENTRAL_FUND_MATERIAL
  );
}

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
 * True only when EVERY item has a non-blank value for the given field
 * AND all of those values are identical - unlike a bare
 * distinctValues(...).size === 1 check, which incorrectly treats "the
 * items that happen to have a value all agree" as a match even when
 * OTHER items have no value at all for that field. A Region & Branch
 * item genuinely has no Department, so it must never satisfy a "Same
 * Department" check just because every item that DOES have a
 * Department happens to agree - this is exactly the gap that let a
 * mixed Department/Region-Branch request wrongly match "Same
 * Department" based on a single item's value.
 *
 * @param {object[]} items
 * @param {string} field
 * @returns {boolean}
 */
function allItemsShareValue(items, field) {
  return (
    items.every((item) => hasText(item[field])) &&
    distinctValues(items, field).size === 1
  );
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
 * @param {string} [costCentreField] - which item field carries the
 *   cost center to match against the Approver Matrix's
 *   departmentBranch column - "costCentre" (GL-based) for Non Project,
 *   "responsibleCostCentre" (WBS-derived) for Project. See
 *   db/schema.cds RequestItems.responsibleCostCentre.
 * @returns {{level: string, userRole: string, departmentBranch: string}[]}
 */
function buildTransferOutCostCentreEntries(
  transferOutItems,
  costCentreField = "costCentre",
) {
  return transferOutItems.map((item, index) => ({
    level: `1${LEVEL_1_LETTERS[index] || index + 1}`,
    userRole: "HOD_XFER_CC",
    departmentBranch: String(item[costCentreField] || "").trim(),
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

function normalizeForComparison(value) {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * True when an item's own Department (Cost Centre -> Department
 * Grouping) IS the given Functional Department - not just "has some
 * department filled in". A Functional Department Grouping row's "Is
 * Department" flag means that functional department is ALSO a
 * department in its own right, and DepartmentGrouping.department is
 * maintained to literally equal FunctionalDepartmentGrouping
 * .functionalDepartment for that case (confirmed live: both tables
 * use the exact same string "EPF LEARNING CENTRE" for that functional
 * department's own cost centres) - so a straight equality check is
 * correct here, it just needs to compare against the right value. An
 * earlier attempt at this compared against a stale/mismatched
 * functionalDepartment value and was wrongly reverted as a result.
 *
 * @param {object} item
 * @param {string} functionalDepartment
 * @returns {boolean}
 */
function isDepartmentItem(item, functionalDepartment) {
  return (
    hasText(item.department) &&
    normalizeForComparison(item.department) ===
      normalizeForComparison(functionalDepartment)
  );
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
 * Branch / Building attributes (computed directly from its
 * department/region/branch/buildingName fields, the same way
 * service.cds's isDepartment/isRegionAndBranch/isBuilding calculated
 * columns do - not read from those columns themselves, since they are
 * populated only by a live OData read and are not reliably present on
 * a plain deep-insert payload item) must satisfy whichever of the
 * matched row's isDepartment/isRegionAndBranch/isBuildingGrouping
 * checkboxes are set - an OR across whichever are checked, so a row
 * with only one checked requires just that one to match (on every
 * Transfer In item, not just one of them), and a row with none
 * checked can never pass this validation. Transfer Out items are held
 * to the Department or Building rule (not Region & Branch).
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

  if (!allItemsShareValue(allItems, "functionalDepartment")) {
    return null;
  }

  if (!transferInItems.length) {
    return null;
  }

  const functionalDepartment = singleValue(allItems, "functionalDepartment");

  const { FunctionalDepartmentGrouping } = cds.entities(SERVICE_NAMESPACE);

  /*
   * A Functional Department has one grouping row per GL Account list
   * (e.g. JABATAN PENGURUSAN HARTA has ~33), and the Building /
   * Department / Region & Branch flags differ from row to row - so the
   * flags that apply to an item are those of the row(s) listing ITS OWN
   * GL Account, never an arbitrary row of that Functional Department.
   * An item without a glAccount falls back to every row of the
   * Functional Department.
   */
  const groupingRows = await tx.run(
    SELECT.from(FunctionalDepartmentGrouping)
      .columns(
        "glAccounts",
        "isDepartment",
        "isRegionAndBranch",
        "isBuildingGrouping",
      )
      .where({ functionalDepartment }),
  );

  if (!groupingRows.length) {
    LOG.warn(
      "Functional Department matched on every item, but no " +
        "Functional Department Grouping master row was found for it " +
        "(deleted since?). Falling through to the standard scenario " +
        "chain.",
      JSON.stringify({ functionalDepartment }),
    );

    return null;
  }

  const flagsForItem = (item) => {
    const glAccount = String(item.glAccount ?? "").trim();

    const rows = glAccount
      ? groupingRows.filter((row) =>
          splitGlAccounts(row.glAccounts).includes(glAccount),
        )
      : groupingRows;

    return {
      isDepartment: rows.some((row) => row.isDepartment),
      isRegionAndBranch: rows.some((row) => row.isRegionAndBranch),
      isBuildingGrouping: rows.some((row) => row.isBuildingGrouping),
    };
  };

  /*
   * A building item: its GL row's "Building Grouping" checkbox is set
   * and the item's cost centre is a Building Grouping cost centre
   * (buildingName is resolved from it). A building cost centre has no
   * Department/Region/Branch of its own, so without this it could never
   * match a functional department that owns buildings.
   */
  const isBuildingItem = (item) =>
    flagsForItem(item).isBuildingGrouping && hasText(item.buildingName);

  /*
   * Each item may satisfy any of the rules its GL row has ticked, so a
   * mix of department-based, branch-based and building items still
   * routes here.
   */
  const transferInItemQualifies = (item) => {
    const flags = flagsForItem(item);

    return (
      isBuildingItem(item) ||
      (flags.isDepartment && isDepartmentItem(item, functionalDepartment)) ||
      (flags.isRegionAndBranch && hasText(item.region) && hasText(item.branch))
    );
  };

  if (!transferInItems.every(transferInItemQualifies)) {
    return null;
  }

  if (
    !transferOutItems.every(
      (item) =>
        isBuildingItem(item) || isDepartmentItem(item, functionalDepartment),
    )
  ) {
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
        buildingName: item.buildingName,
        functionalDepartment: item.functionalDepartment,
        transferOutAmount: item.transferOutAmount,
        transferInAmount: item.transferInAmount,
      })),
    ),
  );

  /*
   * Hardcoded override, checked before everything else in this chain
   * (including the Same Cost Centre check right below, which would
   * otherwise match a Central Fund transfer-out against itself): any
   * Transfer Out line posting against the Central Fund (Fund Center
   * 100050500 + Material Group 760001000) always routes through the
   * JKEW amount-tiered chain at Level 1, regardless of what every
   * item's Department/Branch/Region/Functional Department would
   * otherwise classify as.
   */
  if (transferOutItems.some(isCentralFundTransferOutItem)) {
    return {
      scenario: "Central Fund Transfer Out (amount-tiered)",
      level1Entries: [
        {
          level: "1",
          userRole: resolveAmountTierRole(totalTransferOutAmount),
        },
      ],
      level2Role: null,
      totalTransferOutAmount,
    };
  }

  /*
   * Checked next, ahead of even the Functional Department Grouping
   * match below: every item (transfer-out and transfer-in alike)
   * using the exact same Cost Centre means this request is just
   * reclassifying budget within one cost centre - that cost centre's
   * own head approves it directly, regardless of whether its GL
   * Account also happens to be functional-department-flagged.
   *
   * Every item shares the one same Cost Centre here, so Department/
   * Region/Branch are necessarily identical across all of them too
   * (both are deterministically derived from Cost Centre via the
   * Grouping master data) - checking the first item is enough. Which
   * head approves depends on whether this is a Department-type or a
   * Branch-type cost centre: hardcoding "Head of Department" here
   * regardless wrongly routed a Branch-type cost centre (Department
   * blank, Branch populated) to a department head with no real
   * department to scope the approval to.
   */
  /*
   * Only when every item is also in the same GL Group: a request whose
   * items share one Cost Centre but span different GL Groups is the
   * "Different GL Group, regardless of Cost Center" rule below (Head of
   * Transfer-out Cost Center -> Head of JKEW -> CEO/CFO), not a plain
   * same-cost-centre reclassification.
   */
  if (
    allItemsShareValue(allItems, "costCentre") &&
    allItemsShareValue(allItems, "glGroup")
  ) {
    const [sharedCostCentreItem] = allItems;

    if (hasText(sharedCostCentreItem.department)) {
      return {
        scenario: "Same Cost Centre (Transfer In = Transfer Out) - Department",
        level1Entries: buildSingleLevel1Entry(
          "HOD",
          sharedCostCentreItem.department,
        ),
        level2Role: null,
        totalTransferOutAmount,
      };
    }

    if (hasText(sharedCostCentreItem.branch)) {
      return {
        scenario: "Same Cost Centre (Transfer In = Transfer Out) - Branch",
        level1Entries: buildSingleLevel1Entry(
          "HOB",
          sharedCostCentreItem.branch,
        ),
        level2Role: null,
        totalTransferOutAmount,
      };
    }

    /*
     * Neither Department nor Branch is populated for this shared cost
     * centre - fall through to the rest of the chain below instead of
     * guessing a role with no real departmentBranch to scope it to.
     */
  }

  const functionalDepartmentGroupingMatch =
    await classifyByFunctionalDepartmentGrouping(
      tx,
      transferOutItems,
      transferInItems,
    );

  if (functionalDepartmentGroupingMatch) {
    return functionalDepartmentGroupingMatch;
  }

  const isSameGLGroup = allItemsShareValue(allItems, "glGroup");

  if (!isSameGLGroup) {
    return {
      scenario: "Different GL Group",
      level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
      level2Role: "HOD_JKEW",
      level3Role: "CEO_CFO",
      totalTransferOutAmount,
    };
  }

  if (allItemsShareValue(allItems, "department")) {
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

  if (allItemsShareValue(allItems, "branch")) {
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

  if (allItemsShareValue(allItems, "region")) {
    return {
      scenario: "Same Region, Different Branch",
      level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
      level2Role: "REG_DIR",
      level2DepartmentBranch: singleValue(allItems, "region"),
      totalTransferOutAmount,
    };
  }

  if (allItemsShareValue(allItems, "functionalDepartment")) {
    const authorizedFunctionalDepartment = singleValue(
      allItems,
      "functionalDepartment",
    );

    if (
      transferOutItems.every((item) =>
        isDepartmentItem(item, authorizedFunctionalDepartment),
      )
    ) {
      return {
        scenario: "Authorized Functional Department",
        level1Entries: buildSingleLevel1Entry(
          "HOD_FUNC",
          authorizedFunctionalDepartment,
        ),
        level2Role: null,
        totalTransferOutAmount,
      };
    }
  }

  return {
    scenario: "Relationship criteria not met (amount-tiered)",
    level1Entries: buildTransferOutCostCentreEntries(transferOutItems),
    level2Role: resolveAmountTierRole(totalTransferOutAmount),
    totalTransferOutAmount,
  };
}

/**
 * Classifies a Project Virement request's approval scenario - much
 * simpler than the Non-Project chain above: a Project item is
 * identified by WBS Element alone, whose Responsible Cost Center is
 * auto-derived into the dedicated responsibleCostCentre field (see
 * requestitems-drafts-before-create/update-logic.js and
 * utils/wbs-elements.js - kept separate from costCentre, which stays
 * empty for a Project item since the GL-based Department/Region
 * cascade doesn't apply to WBS-based items). Level 1 is always "Head
 * of Transfer-out Cost Center", resolved once PER TRANSFER-OUT LINE
 * ITEM against that responsibleCostCentre via the Approver Matrix's
 * departmentBranch column (same buildTransferOutCostCentreEntries
 * helper the Non-Project chain uses, just pointed at a different
 * field) - with no further level: a Project Virement approval is one
 * level only.
 *
 * @param {object[]} items - RequestItems rows, each carrying
 *   responsibleCostCentre (the WBS's Responsible Cost Center) and
 *   transferOutAmount
 * @returns {{scenario: string, level1Entries: object[]}|null} null if
 *   there's no transfer-out item yet to resolve
 */
async function classifyVirementProjectScenario(items) {
  const transferOutItems = (items || []).filter(
    (item) => Number(item.transferOutAmount) > 0,
  );

  const transferInItems = (items || []).filter(
    (item) => Number(item.transferInAmount) > 0,
  );

  if (!transferOutItems.length || !transferInItems.length) {
    LOG.info(
      "Not yet classifiable - missing a transfer-out + transfer-in item.",
      JSON.stringify({ transferOutCount: transferOutItems.length }),
    );

    return null;
  }

  const allItems = [...transferOutItems, ...transferInItems];

  const totalTransferOutAmount = transferOutItems.reduce(
    (sum, item) => sum + (Number(item.transferOutAmount) || 0),
    0,
  );

  return {
    scenario: "Project Virement",
    level1Entries: buildTransferOutCostCentreEntries(
      transferOutItems,
      "responsibleCostCentre",
    ),
    level2Role: "HOD_JKEW",
    level3Role: "CEO_CFO",
    totalTransferOutAmount,
  };
}

module.exports = {
  classifyVirementNonProjectScenario,
  classifyVirementProjectScenario,
  REQUEST_TYPE_TRANSFER,
  BUDGET_TYPE_NON_PROJECT,
  BUDGET_TYPE_PROJECT,
};
