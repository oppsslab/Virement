const cds = require("@sap/cds");
const { ROLES } = require("./utils/roles");

const LOG = cds.log("requests-after-read-logic");

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
 * @param {object} user - request.user
 * @param {string} roleName - Role name to check
 * @returns {boolean}
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
 * Determines virtual UI role flags.
 *
 * These are used by annotations for conditional visibility:
 * - isJKEW
 * - isFunctional
 *
 * @param {object} user - request.user
 * @returns {{ isJKEW: boolean, isFunctional: boolean }}
 */
function getUserRoleFlags(user) {
  return {
    isJKEW: hasRole(user, ROLE_JKEW),
    isFunctional: hasRole(user, ROLE_FUNCTIONAL),
  };
}

/**
 * Determines whether the given user is allowed to approve a request.
 *
 * Rules, ALL must be true:
 *   1. User holds the REQUEST_APPROVE role.
 *   2. User is NOT the creator/requestor.
 *
 * @param {object} user - request.user
 * @param {object} row - a single Request record
 * @returns {boolean}
 */
function canUserApprove(user, row) {
  if (!user || !row) {
    return false;
  }

  const hasApproveRole = user.is(ROLES.REQUEST_APPROVE) === true;

  if (!hasApproveRole) {
    return false;
  }

  const userId = user.id;

  /*
   * Block self-approval:
   * User must not be the requestor or creator.
   */
  const isRequestor = !!row.requestor && row.requestor === userId;
  const isCreator = !!row.createdBy && row.createdBy === userId;

  if (isRequestor || isCreator) {
    return false;
  }

  return true;
}

/**
 * Applies virtual UI fields to one Requests row.
 *
 * @param {object} row - Request row
 * @param {object} user - request.user
 * @param {{ isJKEW: boolean, isFunctional: boolean }} roleFlags
 */
function applyVirtualFields(row, user, roleFlags) {
  if (!row) {
    return;
  }

  /*
   * Approval button visibility.
   */
  const allowedToApprove = canUserApprove(user, row);
  row.hideApprovalBtn = !allowedToApprove;

  /*
   * Amount visibility role flags.
   *
   * These fields are virtual and not persisted, so they must be calculated
   * on every READ for both active and draft requests.
   */
  row.isJKEW = roleFlags.isJKEW;
  row.isFunctional = roleFlags.isFunctional;

  LOG.info(
    `Request ${row.ID || row.requestNumber || "?"}: ` +
      `requestType=${row.requestType_code}, ` +
      `requestor=${row.requestor}, createdBy=${row.createdBy}, ` +
      `allowedToApprove=${allowedToApprove}, ` +
      `hideApprovalBtn=${row.hideApprovalBtn}, ` +
      `isJKEW=${row.isJKEW}, ` +
      `isFunctional=${row.isFunctional}`
  );
}

// =============================================================================
//  MAIN HANDLER
//
//  @After(event = { "READ" }, entity = "ZSVC_PPS_VIREMENT.Requests")
//  @After(event = { "READ" }, entity = "ZSVC_PPS_VIREMENT.Requests.drafts")
//
//  Computes virtual fields:
//  - hideApprovalBtn
//  - isJKEW
//  - isFunctional
//
//  Important:
//  These fields are virtual, so they are not persisted.
//  They must be populated during READ for both draft and active records.
// =============================================================================

/**
 * @param {(Object|Object[])} results - READ result or result array
 * @param {cds.Request} request - CAP request context
 */
module.exports = async function (results, request) {
  LOG.info("--- AFTER READ Requests started ---");

  try {
    const user = request.user;

    const hasApproveRole = user?.is(ROLES.REQUEST_APPROVE) === true;
    const roleFlags = getUserRoleFlags(user);

    LOG.info("Target:", request.target?.name);
    LOG.info("User:", user?.id);
    LOG.info("User roles:", JSON.stringify(user?.roles || {}));
    LOG.info("Has REQUEST_APPROVE role:", hasApproveRole);
    LOG.info("Calculated isJKEW:", roleFlags.isJKEW);
    LOG.info("Calculated isFunctional:", roleFlags.isFunctional);

    const list = Array.isArray(results) ? results : [results];

    for (const row of list) {
      applyVirtualFields(row, user, roleFlags);
    }

    LOG.info("--- AFTER READ Requests ended successfully ---");
  } catch (error) {
    /*
     * Secure/default fallback:
     * - Hide approval buttons.
     * - Disable role-based amount visibility.
     */
    LOG.error("Error computing virtual fields:", error);

    const list = Array.isArray(results) ? results : [results];

    for (const row of list) {
      if (row) {
        row.hideApprovalBtn = true;
        row.isJKEW = false;
        row.isFunctional = false;
      }
    }
  }
};