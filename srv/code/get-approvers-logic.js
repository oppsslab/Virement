"use strict";

const cds = require("@sap/cds");

const LOG = cds.log("get-approvers-logic");

/**
 * Reports whether an Approver Matrix row is currently valid: active,
 * and today falls within its Start/End Date (an unset End Date means
 * no expiry, an unset Start Date means always started).
 *
 * @param {object} row
 * @param {string} todayStr - "YYYY-MM-DD"
 * @returns {boolean}
 */
function isCurrentlyValid(row, todayStr) {
  if (!row.isActive) {
    return false;
  }

  if (row.startDate && row.startDate > todayStr) {
    return false;
  }

  if (row.endDate && row.endDate < todayStr) {
    return false;
  }

  return true;
}

/**
 * Resolves a caller-supplied role (either its code, e.g. "HOD", or
 * its full display name, e.g. "Head of Department") to a UserRoles
 * row.
 *
 * @param {object[]} roles - all UserRoles rows: {code, descr}
 * @param {string} userRole - as supplied by the caller
 * @returns {object|null}
 */
function resolveRole(roles, userRole) {
  const normalized = String(userRole ?? "").trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  return (
    roles.find((role) => String(role.code ?? "").toUpperCase() === normalized) ||
    roles.find(
      (role) => String(role.descr ?? "").trim().toUpperCase() === normalized,
    ) ||
    null
  );
}

/**
 * Serves getApprovers(userRole, departmentBranch) for SAP Build
 * Process Automation: the current, valid approver(s) for a role.
 *
 * @param {cds.Request} request
 * @returns {Promise<object[]>}
 */
module.exports = async function getApprovers(request) {
  const userRole = request.data?.userRole;
  const departmentBranch = request.data?.departmentBranch;

  if (!userRole) {
    return request.error(400, "userRole is required.");
  }

  const tx = cds.tx(request);
  const { ApproverMatrix, UserRoles } = cds.entities("ZSVC_PPS_VIREMENT");

  const roles = await tx.run(SELECT.from(UserRoles).columns("code", "descr"));

  const role = resolveRole(roles, userRole);

  if (!role) {
    LOG.warn(`getApprovers: no matching User Role for "${userRole}".`);

    return [];
  }

  const rows = await tx.run(
    SELECT.from(ApproverMatrix)
      .columns(
        "emailAddress",
        "name",
        "departmentBranch",
        "isActive",
        "startDate",
        "endDate",
      )
      .where({ userRole_code: role.code }),
  );

  const today = new Date().toISOString().slice(0, 10);

  const normalizedDept = departmentBranch
    ? String(departmentBranch).trim().toLowerCase()
    : null;

  const approvers = rows.filter((row) => {
    if (!isCurrentlyValid(row, today)) {
      return false;
    }

    if (
      normalizedDept &&
      String(row.departmentBranch ?? "").trim().toLowerCase() !== normalizedDept
    ) {
      return false;
    }

    return true;
  });

  LOG.info(
    `getApprovers: role="${userRole}" departmentBranch="${departmentBranch || ""}" -> ${approvers.length} approver(s).`,
  );

  return approvers.map((row) => ({
    emailAddress: row.emailAddress,
    name: row.name,
    userRole: role.descr,
    departmentBranch: row.departmentBranch,
  }));
};
