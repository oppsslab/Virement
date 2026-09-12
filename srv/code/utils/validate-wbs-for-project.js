"use strict";

const cds = require("@sap/cds");

const LOG = cds.log("validate-wbs-for-project");

const BUDGET_TYPE_PROJECT = "P";

/**
 * Validates that WBS is filled on every request item whenever the
 * budget type is "Project" (P) - regardless of request type
 * (Supplement, Return, or Transfer). Matches the item table's own
 * Common.FieldControl on wbs (annotations.cds), which is Mandatory
 * for a Project item.
 *
 * Shared by requests-before-create-logic.js (first submission) and
 * requests-resubmit-logic.js (resubmission after rejection) - a
 * rejected request can be edited before resubmitting, so this must be
 * re-checked there too, not just on first submit.
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @param {string} options.budgetTypeCode
 * @returns {boolean}
 */
function validateWbsForProjectBudget(request, { items, budgetTypeCode }) {
  const budgetType = String(budgetTypeCode || "")
    .trim()
    .toUpperCase();

  if (budgetType !== BUDGET_TYPE_PROJECT) {
    return true;
  }

  const itemsMissingWbs = (items || []).filter(function (item) {
    return !String(item.wbs || "").trim();
  });

  if (itemsMissingWbs.length > 0) {
    const missingItemIds = itemsMissingWbs
      .map(function (item, index) {
        return item.ID || `#${index + 1}`;
      })
      .join(", ");

    LOG.error(
      "WBS is required for all Request Items when Budget Type is " +
        "Project. Missing on items:",
      missingItemIds,
    );

    request.error(
      400,
      "WBS is required for all Request Items when Budget Type is " +
        "Project.",
    );

    return false;
  }

  return true;
}

module.exports = { validateWbsForProjectBudget };
