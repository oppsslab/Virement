"use strict";

const cds = require("@sap/cds");

const { REQUEST_STATUS } = require("./utils/request-status");

const { applyAgingToRows } = require("./utils/request-aging");

const {
  getWorkflowInstanceStatus,
  getWorkflowInstanceErrorMessages,
  ERROR_WORKFLOW_STATUSES,
} = require("./utils/workflow-utils");

const LOG = cds.log("requests-after-read-logic");

const REQUESTS_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.Requests";

const REQUEST_APPROVER_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.RequestApprovers";

const ROLE_JKEW = "MASS_UPLOAD_ALL";

const ROLE_FUNCTIONAL = "MASS_UPLOAD_TRANSFER";

/*
 * workflowStatus values that mean the workflow instance is done and
 * will never change again - no point calling out to SAP Build to
 * refresh it once a request reaches one of these.
 */
const TERMINAL_WORKFLOW_STATUSES = ["COMPLETED", "REJECTED"];

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

/**
 * Loads Request fields omitted by the UI's $select.
 *
 * Approver status is tracked per-approver in RequestApprovers, and is
 * loaded separately by loadPendingApproverEmails below.
 *
 * @param {object[]} rows
 * @param {cds.Request} request
 */
async function enrichApprovalData(rows, request) {
  const rowsToLoad = rows.filter(
    (row) =>
      row?.ID &&
      (row.status_code === undefined ||
        row.requestNumber === undefined ||
        row.currentApprovalLevel === undefined ||
        row.submissionDate === undefined),
  );

  if (!rowsToLoad.length) {
    return;
  }

  const ids = rowsToLoad.map((row) => row.ID);

  const databaseRows = await cds.db.run(
    SELECT.from(REQUESTS_DATABASE_ENTITY)
      .columns(
        "ID",
        "requestNumber",
        "status_code",
        "currentApprovalLevel",
        "requestor",
        "createdBy",
        "submissionDate",
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

    row.status_code ??= databaseRow.status_code;

    row.currentApprovalLevel ??= databaseRow.currentApprovalLevel;

    row.requestor ??= databaseRow.requestor;

    row.createdBy ??= databaseRow.createdBy;

    row.submissionDate ??= databaseRow.submissionDate;
  }
}

/**
 * Loads the set of Request IDs for which the given user currently
 * has a Pending RequestApprovers row.
 *
 * A user may appear as an approver on multiple levels over the
 * lifetime of a request, but only rows still in Pending Approval
 * status represent an actionable approval for that user right now.
 *
 * @param {string[]} requestIds
 * @param {string} normalizedCurrentUser
 * @returns {Promise<Set<string>>}
 */
async function loadPendingApproverRequestIds(
  requestIds,
  normalizedCurrentUser,
) {
  if (!requestIds.length || !normalizedCurrentUser) {
    return new Set();
  }

  const pendingApproverRows = await cds.db.run(
    SELECT.from(REQUEST_APPROVER_DATABASE_ENTITY)
      .columns("request_ID", "emailAddress", "status_code")
      .where({
        request_ID: {
          in: requestIds,
        },
        status_code: REQUEST_STATUS.PENDING_APPROVAL,
      }),
  );

  const matchingRequestIds = pendingApproverRows
    .filter(
      (approverRow) =>
        normalizeUserId(approverRow.emailAddress) === normalizedCurrentUser,
    )
    .map((approverRow) => approverRow.request_ID);

  return new Set(matchingRequestIds);
}

function applyVirtualFields(row, user, roleFlags, pendingApproverRequestIds) {
  row.isPendingApprover = pendingApproverRequestIds.has(row.ID);

  row.isJKEW = roleFlags.isJKEW;

  row.isFunctional = roleFlags.isFunctional;

  LOG.info("Calculated request UI flags", {
    requestId: row.ID,

    requestNumber: row.requestNumber,

    currentUser: user?.id,

    statusCode: row.status_code,

    currentApprovalLevel: row.currentApprovalLevel,

    isActiveEntity: row.IsActiveEntity,

    isPendingApprover: row.isPendingApprover,

    isJKEW: row.isJKEW,

    isFunctional: row.isFunctional,
  });
}

/**
 * Live-refreshes workflowStatus from SAP Build Process Automation
 * for a single-entity (Object Page) read, instead of relying on
 * whatever snapshot CAP last happened to persist. Skipped for list
 * reads (to avoid one BPA call per row) and for requests already in
 * a terminal workflow state.
 *
 * @param {object[]} rows
 * @param {cds.Request} request
 */
async function refreshLiveWorkflowStatus(rows, request) {
  try {
    const isSingleEntityRead = Boolean(
      request.params && request.params.length,
    );

    if (!isSingleEntityRead) {
      return;
    }

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
     * the read response (approval flags, aging, etc. already
     * computed above this call).
     */
    LOG.error("Error refreshing live workflow status.", {
      message: error.message,
    });
  }
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

    /*
     * Determine which of these requests the current user is a
     * pending approver for, based on RequestApprovers rows.
     */
    const normalizedCurrentUser = normalizeUserId(user?.id);

    const requestIds = rows.map((row) => row.ID);

    const pendingApproverRequestIds = await loadPendingApproverRequestIds(
      requestIds,
      normalizedCurrentUser,
    );

    for (const row of rows) {
      applyVirtualFields(row, user, roleFlags, pendingApproverRequestIds);
    }

    await applyAgingToRows(rows);

    /*
     * Live-refresh workflowStatus from SAP Build when a single
     * request is opened (Object Page), rather than showing whatever
     * snapshot was last persisted.
     */
    await refreshLiveWorkflowStatus(rows, request);
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

    /*
     * Aging is independent of the flags above, and the persisted
     * column it falls back to is always 0. Compute it even when the
     * flags could not be resolved.
     */
    try {
      await applyAgingToRows(rows);
    } catch (agingError) {
      LOG.error("Error computing request aging", {
        message: agingError.message,
      });
    }
  }
};
