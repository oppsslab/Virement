const cds = require("@sap/cds");

const LOG = cds.log("requests-drafts-after-read-logic");

// =============================================================================
//  ROLE CONSTANTS
// =============================================================================

const ROLE_JKEW = "MASS_UPLOAD_ALL";
const ROLE_FUNCTIONAL = "MASS_UPLOAD_TRANSFER";

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

// =============================================================================
//  MAIN HANDLER
//
//  @After(event = { "READ" }, entity = "ZSVC_PPS_VIREMENT.Requests.drafts")
//
//  Populates virtual/display fields:
//  - isJKEW
//  - isFunctional
//  - transferCategory fallback for draft UI display
//
//  These fields must be filled every time Requests.drafts is read.
// =============================================================================

/**
 * @param {Object|Object[]} results - result or result array from READ
 * @param {cds.Request} request - CAP request context
 */
module.exports = async function (results, request) {
  LOG.info("--- AFTER READ Requests.drafts started ---");

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