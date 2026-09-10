"use strict";

/**
 * Determines whether the logged-in user has the specified role.
 *
 * Supports:
 * - CAP user.is(...)
 * - user.roles as an array
 * - user.roles as an object
 *
 * @param {object} user
 * @param {string} roleName
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
   *
   * Example:
   * [
   *   "MASS_UPLOAD_ALL",
   *   "OTHER_ROLE"
   * ]
   */
  if (Array.isArray(user.roles)) {
    return user.roles.some(function (role) {
      return (
        String(role || "")
          .trim()
          .toUpperCase() === normalizedRoleName
      );
    });
  }

  /*
   * Fallback: roles as object.
   *
   * Example:
   * {
   *   MASS_UPLOAD_ALL: true
   * }
   */
  if (user.roles && typeof user.roles === "object") {
    return Object.keys(user.roles).some(function (role) {
      return (
        String(role || "")
          .trim()
          .toUpperCase() === normalizedRoleName && user.roles[role] === true
      );
    });
  }

  return false;
}

module.exports = { hasRole };
