const cds = require("@sap/cds");

const { applyAgingToRows } = require("./utils/request-aging");

const {
  getWorkflowInstanceStatus,
  getWorkflowInstanceErrorMessages,
  ERROR_WORKFLOW_STATUSES,
} = require("./utils/workflow-utils");

const LOG = cds.log("requests-drafts-after-read-logic");

// =============================================================================
//  ROLE CONSTANTS
// =============================================================================

const ROLE_JKEW = "MASS_UPLOAD_ALL";
const ROLE_FUNCTIONAL = "MASS_UPLOAD_TRANSFER";

const REQUESTS_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.Requests";

/*
 * workflowStatus values that mean the workflow instance is done and
 * will never change again - no point calling out to SAP Build to
 * refresh it once a request reaches one of these.
 */
const TERMINAL_WORKFLOW_STATUSES = ["COMPLETED", "REJECTED"];

// =============================================================================
//  HELPERS
// =============================================================================

/**
 * Checks whether the current CAP user has a specific role.
 *
 * Supports:
 * - user.is("ROLE")
 * - user.roles as array
 * - user.roles as object, for example { ROLE: true }
 *
 * @param {Object} user - request.user
 * @param {String} roleName - role name to check
 * @returns {Boolean}
 */
function hasRole(user, roleName) {
  if (!user || !roleName) {
    return false;
  }

  const normalizedRoleName = String(roleName).trim().toUpperCase();

  /*
   * Preferred CAP-style role check.
   */
  if (typeof user.is === "function" && user.is(normalizedRoleName)) {
    return true;
  }

  /*
   * Fallback: roles as array.
   */
  if (Array.isArray(user.roles)) {
    return user.roles.some(function (role) {
      return String(role || "").trim().toUpperCase() === normalizedRoleName;
    });
  }

  /*
   * Fallback: roles as object.
   * Example:
   * {
   *   MASS_UPLOAD_ALL: true,
   *   MASS_UPLOAD_TRANSFER: true
   * }
   */
  if (user.roles && typeof user.roles === "object") {
    return Object.keys(user.roles).some(function (role) {
      return (
        String(role || "").trim().toUpperCase() === normalizedRoleName &&
        user.roles[role] === true
      );
    });
  }

  return false;
}

/**
 * Determines the virtual role flags used by the UI.
 *
 * @param {Object} user - request.user
 * @returns {{ isJKEW: Boolean, isFunctional: Boolean }}
 */
function getUserRoleFlags(user) {
  return {
    isJKEW: hasRole(user, ROLE_JKEW),
    isFunctional: hasRole(user, ROLE_FUNCTIONAL),
  };
}

/**
 * Normalizes code values.
 *
 * @param {any} value
 * @returns {String}
 */
function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

/**
 * Determines transferCategory for READ response/UI display.
 *
 * Priority:
 *   1. Existing persisted transferCategory
 *   2. T + JKEW role       -> J
 *   3. T + Functional role -> F
 *   4. T + budgetType P    -> P
 *   5. T + budgetType N    -> N
 *
 * Notes:
 * - This is only for the READ response.
 * - This does not persist transferCategory to the draft table.
 * - If both isJKEW and isFunctional are true, JKEW wins and returns "J".
 *
 * @param {Object} row - Requests row
 * @param {Object} roleFlags - calculated role flags
 * @returns {String|null}
 */
function determineTransferCategoryForRead(row, roleFlags) {
  if (!row) {
    return null;
  }

  const existingCategory = normalizeCode(row.transferCategory);
  const requestType = normalizeCode(row.requestType_code);
  const budgetType = normalizeCode(row.budgetType_code);

  /*
   * Keep persisted category if already available.
   */
  if (existingCategory) {
    return existingCategory;
  }

  /*
   * Only Transfer requests have transferCategory.
   */
  if (requestType !== "T") {
    return null;
  }

  /*
   * Role-based transfer categories.
   */
  if (roleFlags.isJKEW) {
    return "J";
  }

  if (roleFlags.isFunctional) {
    return "F";
  }

  /*
   * Normal transfer categories based on budget type.
   */
  if (budgetType === "P") {
    return "P";
  }

  if (budgetType === "N") {
    return "N";
  }

  /*
   * In an incomplete draft, budget type may not be selected yet.
   */
  return null;
}

/**
 * Applies virtual role flags and transfer category fallback to one Requests row.
 *
 * @param {Object} row - Requests row
 * @param {Object} roleFlags - calculated user role flags
 */
function applyRoleFlags(row, roleFlags) {
  if (!row) {
    return;
  }

  /*
   * Current-user role flags.
   * These are virtual fields.
   */
  row.isJKEW = roleFlags.isJKEW;
  row.isFunctional = roleFlags.isFunctional;

  /*
   * transferCategory is persisted, but drafts may still have null.
   * This fallback makes annotations work during draft display.
   */
  row.transferCategory = determineTransferCategoryForRead(row, roleFlags);

  LOG.info(
    "Applied draft read flags: " +
      JSON.stringify({
        ID: row.ID,
        requestNumber: row.requestNumber,
        requestType_code: row.requestType_code,
        budgetType_code: row.budgetType_code,
        transferCategory: row.transferCategory,
        isJKEW: row.isJKEW,
        isFunctional: row.isFunctional,
      })
  );
}

/**
 * Live-refreshes workflowStatus from SAP Build Process Automation
 * for a single-entity (Object Page) read, instead of relying on
 * whatever snapshot CAP last happened to persist. Skipped for list
 * reads (to avoid one BPA call per row) and for requests already in
 * a terminal workflow state.
 *
 * @param {Object|Object[]} results
 * @param {cds.Request} request
 */
async function refreshLiveWorkflowStatus(results, request) {
  try {
    const isSingleEntityRead = Boolean(
      request.params && request.params.length,
    );

    if (!isSingleEntityRead) {
      return;
    }

    const rows = (Array.isArray(results) ? results : [results]).filter(
      function (row) {
        return row && row.ID;
      },
    );

    for (const row of rows) {
      if (!row.workflowInstanceId) {
        continue;
      }

      if (TERMINAL_WORKFLOW_STATUSES.includes(row.workflowStatus)) {
        continue;
      }

      const liveStatus = await getWorkflowInstanceStatus(
        row.workflowInstanceId,
      );

      if (!liveStatus) {
        continue;
      }

      const statusChanged = liveStatus !== row.workflowStatus;
      const isErrorStatus = ERROR_WORKFLOW_STATUSES.includes(liveStatus);
      const needsErrorFetch = isErrorStatus && !row.workflowError;

      if (!statusChanged && !needsErrorFetch) {
        continue;
      }

      const updates = {};

      if (statusChanged) {
        row.workflowStatus = liveStatus;
        updates.workflowStatus = liveStatus;

        if (!isErrorStatus && row.workflowError) {
          row.workflowError = null;
          updates.workflowError = null;
        }
      }

      if (needsErrorFetch) {
        const workflowError = await getWorkflowInstanceErrorMessages(
          row.workflowInstanceId,
        );

        if (workflowError) {
          row.workflowError = workflowError;
          updates.workflowError = workflowError;
        }
      }

      if (Object.keys(updates).length) {
        try {
          await cds.db.run(
            UPDATE(REQUESTS_DATABASE_ENTITY)
              .set(updates)
              .where({ ID: row.ID }),
          );
        } catch (error) {
          LOG.error("Failed to persist refreshed workflow status/error.", {
            requestId: row.ID,
            message: error.message,
          });
        }
      }
    }
  } catch (error) {
    /*
     * Never let a live-status refresh failure disturb the rest of
     * the read response.
     */
    LOG.error("Error refreshing live workflow status (drafts):", {
      message: error.message,
    });
  }
}

// =============================================================================
//  MAIN HANDLER
//
//  @After(event = { "READ" }, entity = "ZSVC_PPS_VIREMENT.Requests.drafts")
//
//  Populates virtual/display fields:
//  - isJKEW
//  - isFunctional
//  - transferCategory fallback for draft UI display
//  - aging
//
//  These fields must be filled every time Requests.drafts is read.
// =============================================================================

/**
 * @param {Object|Object[]} results - result or result array from READ
 * @param {cds.Request} request - CAP request context
 */
module.exports = async function (results, request) {
  LOG.info("--- AFTER READ Requests.drafts started ---");

  /*
   * Fiori Elements serves the list through this entity whenever its
   * filter carries the IsActiveEntity / SiblingEntity predicates, so
   * aging has to be computed here as well. Without it the rows carry
   * the persisted aging column, which is never written and always 0.
   *
   * Kept outside the role-flag try block: the two are independent, and
   * a failure in either must not suppress the other.
   */
  try {
    await applyAgingToRows(results);
  } catch (error) {
    LOG.error("Error computing request aging on drafts read:", error);
  }

  /*
   * Live-refresh workflowStatus from SAP Build when a single request
   * is opened (Object Page), rather than showing whatever snapshot
   * was last persisted. Self-contained (never throws), independent
   * of the role-flag/aging logic above and below.
   */
  await refreshLiveWorkflowStatus(results, request);

  try {
    const roleFlags = getUserRoleFlags(request.user);

    LOG.info("User ID:", request.user?.id);
    LOG.info("User roles:", JSON.stringify(request.user?.roles || {}));
    LOG.info("Calculated isJKEW:", roleFlags.isJKEW);
    LOG.info("Calculated isFunctional:", roleFlags.isFunctional);

    if (Array.isArray(results)) {
      results.forEach(function (row) {
        applyRoleFlags(row, roleFlags);
      });
    } else {
      applyRoleFlags(results, roleFlags);
    }

    LOG.info("--- AFTER READ Requests.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-drafts-after-read-logic:", error);

    /*
     * Do not fail READ only because virtual UI role flags failed.
     * Default both flags to false if possible.
     */
    const fallbackFlags = {
      isJKEW: false,
      isFunctional: false,
    };

    if (Array.isArray(results)) {
      results.forEach(function (row) {
        applyRoleFlags(row, fallbackFlags);
      });
    } else {
      applyRoleFlags(results, fallbackFlags);
    }
  }
};