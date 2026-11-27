"use strict";

const cds = require("@sap/cds");

const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const LOG = cds.log("requests-list-scope-logic");

const REQUEST_APPROVER_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.RequestApprovers";

const APPROVER_FLAG = "isPendingApprover";

const MY_REQUEST_FLAG = "isMyRequest";

const REPORT_ROLE_ADMIN = "ADMIN";

const REPORT_ROLE_BCM = "BUDGET_ZERORISE";

/*
 * Well-formed UUID that cannot match a row, used to force an empty
 * result while still sending the database valid SQL.
 */
const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Reports whether a CQN where-clause references the given column.
 *
 * @param {Array} where
 * @param {string} column
 * @returns {boolean}
 */
function whereReferences(where, column) {
  if (!Array.isArray(where)) {
    return false;
  }

  return where.some((token) => {
    if (!token || typeof token !== "object") {
      return false;
    }

    if (Array.isArray(token.ref)) {
      return token.ref[token.ref.length - 1] === column;
    }

    if (Array.isArray(token.xpr)) {
      return whereReferences(token.xpr, column);
    }

    return false;
  });
}

/**
 * Neutralizes every comparison on the given column, in place.
 *
 * The comparison triple (ref, operator, value) is replaced by the
 * always-true expression 1 = 1 rather than deleted. Deleting it would
 * leave a dangling and/or operator whenever the client wraps
 * conditions in parentheses, producing a malformed CQN. Substitution
 * keeps the shape of the expression exactly as it was.
 *
 * The column is virtual, so leaving the original comparison in place
 * would reach the database as a non-existent column.
 *
 * @param {Array} where
 * @param {string} column
 * @returns {Array}
 */
function neutralizeColumnComparisons(where, column) {
  if (!Array.isArray(where)) {
    return where;
  }

  const result = [];

  for (let index = 0; index < where.length; index += 1) {
    const token = where[index];

    if (token && typeof token === "object" && Array.isArray(token.xpr)) {
      result.push({
        ...token,
        xpr: neutralizeColumnComparisons(token.xpr, column),
      });

      continue;
    }

    const isTarget =
      token &&
      typeof token === "object" &&
      Array.isArray(token.ref) &&
      token.ref[token.ref.length - 1] === column;

    if (!isTarget) {
      result.push(token);

      continue;
    }

    /*
     * Swap the whole comparison for a constant truth, leaving the
     * surrounding operators untouched. ID is the key, so it is never
     * null and the comparison always holds.
     */
    result.push({ ref: ["ID"] }, "=", { ref: ["ID"] });

    index += 2;
  }

  return result;
}

/**
 * Loads the request ids the given user is currently a pending
 * approver on.
 *
 * @param {string} userEmail
 * @returns {Promise<string[]>}
 */
async function loadMyPendingRequestIds(userEmail) {
  const approverRows = await cds.db.run(
    SELECT.from(REQUEST_APPROVER_DATABASE_ENTITY)
      .columns("request_ID", "emailAddress")
      .where({ status_code: APPROVER_STATUS.PENDING_APPROVAL })
  );

  return [
    ...new Set(
      (approverRows || [])
        .filter((row) => normalizeEmail(row.emailAddress) === userEmail)
        .map((row) => row.request_ID)
        .filter(Boolean)
    ),
  ];
}

/**
 * Loads the request ids the given user has already approved (a real
 * action, not a sibling auto-resolved in the same parallel level -
 * those have no actionDate), whatever the request's status is now.
 *
 * @param {string} userEmail
 * @returns {Promise<string[]>}
 */
async function loadMyApprovedRequestIds(userEmail) {
  const approverRows = await cds.db.run(
    SELECT.from(REQUEST_APPROVER_DATABASE_ENTITY)
      .columns("request_ID", "emailAddress")
      .where({
        status_code: APPROVER_STATUS.APPROVED,
        actionDate: { "!=": null },
      })
  );

  return [
    ...new Set(
      (approverRows || [])
        .filter((row) => normalizeEmail(row.emailAddress) === userEmail)
        .map((row) => row.request_ID)
        .filter(Boolean)
    ),
  ];
}

function idList(ids) {
  return { list: ids.map((val) => ({ val })) };
}

/**
 * Scopes collection reads of Requests.
 *
 * Three lists share this entity, so the incoming filter decides which
 * rule applies:
 *
 *   Pending Approvals - sends isPendingApprover eq true. That field is
 *     virtual and cannot be filtered in SQL, so the comparison is
 *     stripped and replaced with the real ids the user must approve.
 *
 *   My Requests - sends isMyRequest eq true. Also virtual for the same
 *     reason, stripped and replaced with a real WHERE on the requestor
 *     column (which already stores the creating user's id).
 *
 *   Virement Requests - sends no such filter, and is left unscoped.
 *     The View All Requests tile shows every requestor's request, so
 *     there is nothing to narrow here; visibility is governed by the
 *     open READ rule in srv/service.cds.
 *
 * Reads addressed by ID are left alone. That covers the object page and
 * the internal by-key lookups in the approve/reject flow, so an
 * approver can still open a request raised by someone else. Access
 * there remains bounded by the @restrict rules.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<void>}
 */
module.exports = async function scopeRequestsList(request) {
  const select = request.query && request.query.SELECT;

  if (!select) {
    return;
  }

  const where = select.where;

  /*
   * Single-record access must not be narrowed, otherwise an approver
   * could not open a request raised by someone else.
   *
   * Detected via SELECT.one (internal by-key lookups, such as the
   * approve/reject flow) and via request params (an OData read
   * addressed by key, which is how the object page loads). Scanning the
   * where-clause for an ID reference is deliberately avoided: the draft
   * union joins on ID, so that test also matched list reads and left
   * the active half of the union unscoped.
   */
  const isKeyedRead = Array.isArray(request.params) && request.params.length > 0;

  if (select.one || isKeyedRead) {
    return;
  }

  const userEmail = normalizeEmail(request.user && request.user.id);

  const wantsMyApprovals = whereReferences(where, APPROVER_FLAG);

  if (wantsMyApprovals) {
    select.where = neutralizeColumnComparisons(where, APPROVER_FLAG);

    if (!userEmail) {
      request.query.where({ ID: NO_MATCH_ID });

      return;
    }

    const [myRequestIds, myApprovedIds] = await Promise.all([
      loadMyPendingRequestIds(userEmail),
      loadMyApprovedRequestIds(userEmail),
    ]);

    LOG.info(
      `Pending Approvals for ${userEmail}: ${myRequestIds.length} pending, ` +
        `${myApprovedIds.length} already approved.`
    );

    /*
     * Still-pending requests, plus every request this user has already
     * approved (any status, so they can check it back afterwards).
     */
    const conditions = [];

    if (myRequestIds.length) {
      conditions.push({
        xpr: [
          { ref: ["ID"] },
          "in",
          idList(myRequestIds),
          "and",
          { ref: ["status_code"] },
          "=",
          { val: REQUEST_STATUS.PENDING_APPROVAL },
        ],
      });
    }

    if (myApprovedIds.length) {
      conditions.push({
        xpr: [{ ref: ["ID"] }, "in", idList(myApprovedIds)],
      });
    }

    if (!conditions.length) {
      request.query.where({ ID: NO_MATCH_ID });

      return;
    }

    const orXpr = [];

    conditions.forEach((condition, index) => {
      if (index > 0) {
        orXpr.push("or");
      }

      orXpr.push(condition);
    });

    request.query.where([{ xpr: orXpr }]);

    return;
  }

  const wantsMyRequests = whereReferences(where, MY_REQUEST_FLAG);

  if (wantsMyRequests) {
    select.where = neutralizeColumnComparisons(where, MY_REQUEST_FLAG);

    if (!userEmail) {
      request.query.where({ ID: NO_MATCH_ID });

      return;
    }

    LOG.info(`My Requests for ${userEmail}.`);

    request.query.where({ requestor: request.user.id });

    return;
  }

  /*
   * View All Requests (Request Report) is otherwise unscoped - every
   * user sees every requestor's request - except a Draft: it hasn't
   * been submitted yet, so it isn't a real request to report on, and
   * showing it here would surface another requestor's still-private,
   * in-progress draft.
   */
  const user = request.user;
  const canViewReport =
    user &&
    typeof user.is === "function" &&
    (user.is(REPORT_ROLE_ADMIN) || user.is(REPORT_ROLE_BCM));

  /*
   * The draft half of a union read (My Requests, Pending Approvals
   * with "Editing Status: All") reaches this handler a second time
   * with the flag filter already stripped, so it looks like the
   * unscoped report. The block is therefore enforced on the active
   * entity only - the report's own read always includes that half.
   */
  const isDraftRead = String(request.target?.name || "").endsWith(".drafts");

  if (!canViewReport && !isDraftRead) {
    LOG.warn(
      `Request Report blocked for ${userEmail || "unknown user"} - Admin or BCM role required.`
    );

    return request.reject(
      403,
      "Only Admin and BCM users can view the Request Report."
    );
  }

  request.query.where({ status_code: { "!=": REQUEST_STATUS.DRAFT } });

  LOG.info(`Virement Requests unscoped (excluding Draft) for ${userEmail || "unknown user"}.`);
};
