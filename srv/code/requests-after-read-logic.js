"use strict";

const cds = require("@sap/cds");

const LOG = cds.log("requests-after-read-logic");

const DATABASE_ENTITY = "ZDB_PPS_VIREMENT.Requests";

const ROLE_JKEW = "MASS_UPLOAD_ALL";

const ROLE_FUNCTIONAL = "MASS_UPLOAD_TRANSFER";

function hasRole(user, roleName) {
  return Boolean(
    user && roleName && typeof user.is === "function" && user.is(roleName),
  );
}

function normalizeUserId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

async function enrichApprovalData(rows, request) {
  const rowsToLoad = rows.filter(
    (row) =>
      row?.ID &&
      (row.pendingApprover === undefined ||
        row.status_code === undefined ||
        row.requestNumber === undefined),
  );

  if (!rowsToLoad.length) {
    return;
  }

  const ids = rowsToLoad.map((row) => row.ID);

  const databaseRows = await cds.db.run(
    SELECT.from(DATABASE_ENTITY)
      .columns(
        "ID",
        "requestNumber",
        "pendingApprover",
        "status_code",
        "requestor",
        "createdBy",
      )
      .where({
        ID: {
          in: ids,
        },
      }),
  );

  const databaseRowsById = new Map(databaseRows.map((row) => [row.ID, row]));

  for (const row of rowsToLoad) {
    const databaseRow = databaseRowsById.get(row.ID);

    if (!databaseRow) {
      continue;
    }

    row.requestNumber ??= databaseRow.requestNumber;

    row.pendingApprover ??= databaseRow.pendingApprover;

    row.status_code ??= databaseRow.status_code;

    row.requestor ??= databaseRow.requestor;

    row.createdBy ??= databaseRow.createdBy;
  }
}

function applyVirtualFields(row, user, roleFlags) {
  const currentUser = normalizeUserId(user?.id);

  const pendingApprover = normalizeUserId(row.pendingApprover);

  row.isPendingApprover =
    currentUser !== "" &&
    pendingApprover !== "" &&
    currentUser === pendingApprover;

  row.isJKEW = roleFlags.isJKEW;

  row.isFunctional = roleFlags.isFunctional;

  LOG.info("Calculated request UI flags", {
    requestId: row.ID,

    requestNumber: row.requestNumber,

    currentUser: user?.id,

    pendingApprover: row.pendingApprover,

    statusCode: row.status_code,

    isActiveEntity: row.IsActiveEntity,

    isPendingApprover: row.isPendingApprover,

    isJKEW: row.isJKEW,

    isFunctional: row.isFunctional,
  });
}

module.exports = async function requestsAfterRead(results, request) {
  const rows = (Array.isArray(results) ? results : [results]).filter(
    (row) => row && row.ID,
  );

  if (!rows.length) {
    return;
  }

  try {
    const user = request.user;

    const roleFlags = {
      isJKEW: hasRole(user, ROLE_JKEW),

      isFunctional: hasRole(user, ROLE_FUNCTIONAL),
    };

    /*
     * Load properties omitted by the UI $select.
     */
    await enrichApprovalData(rows, request);

    for (const row of rows) {
      applyVirtualFields(row, user, roleFlags);
    }
  } catch (error) {
    LOG.error("Error computing request UI fields", {
      message: error.message,

      stack: error.stack,
    });

    /*
     * Secure fallback.
     */
    for (const row of rows) {
      row.isPendingApprover = false;

      row.isJKEW = false;

      row.isFunctional = false;
    }
  }
};
