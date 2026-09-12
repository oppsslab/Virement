"use strict";

const cds = require("@sap/cds");

const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const LOG = cds.log("pending-approvals-for-approver-scope-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/*
 * Well-formed UUID that cannot match a row, used to force an empty
 * result while still sending the database valid SQL. Same technique
 * as requests-list-scope-logic.js.
 */
const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeRole(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Reports whether this READ was reached via
 * ApproverMatrix(...)/PendingApprovals - as opposed to any other read
 * of RequestApprovers (the #Approvers facet on the Requests Object
 * Page, reached via Requests.RequestApprovers; or a direct/
 * administrative read).
 *
 * @param {object} select - request.query.SELECT
 * @returns {boolean}
 */
function isPendingApprovalsNavigation(select) {
  const ref = select?.from?.ref;

  if (!Array.isArray(ref)) {
    return false;
  }

  /*
   * "PendingApprovals" is an unambiguous navigation name - only
   * ApproverMatrix has a navigation property by that name, and it is
   * the only way to reach RequestApprovers through it. Checking for
   * its presence ANYWHERE in the ref path (rather than assuming an
   * exact segment count/shape, e.g. exactly 2 segments with
   * ApproverMatrix immediately before it) is deliberately lenient: a
   * first attempt assumed a specific shape and silently never matched
   * anything, since CAP's actual CQN for a draft-enabled parent's
   * navigation nests differently than assumed - confirmed by this
   * scoping never taking effect at all in production. Matching on the
   * segment name alone is robust to however many segments CAP wraps
   * around it.
   */
  return ref.some((segment) => {
    const name = typeof segment === "string" ? segment : segment?.id;

    return name === "PendingApprovals";
  });
}

/**
 * Fallback for resolving the Approver Matrix parent key directly from
 * the CQN "from" ref, for the case request.params turns out not to
 * carry it reliably for this navigation shape (params has already
 * been observed to be an unreliable assumption once - see
 * isPendingApprovalsNavigation's comment).
 *
 * Expects the first ref segment's "where" array to hold a plain
 * `[{ref:['ID']}, '=', {val: '<guid>'}]`-shaped key comparison, the
 * standard CQN form for a single-key navigation source.
 *
 * @param {Array} ref - select.from.ref
 * @returns {string|null}
 */
function extractParentKeyFromRef(ref) {
  const firstSegment = Array.isArray(ref) ? ref[0] : null;

  const where =
    firstSegment && typeof firstSegment === "object"
      ? firstSegment.where
      : null;

  if (!Array.isArray(where)) {
    return null;
  }

  for (let index = 0; index < where.length - 2; index += 1) {
    const left = where[index];
    const operator = where[index + 1];
    const right = where[index + 2];

    const isIdComparison =
      left &&
      Array.isArray(left.ref) &&
      left.ref[left.ref.length - 1] === "ID" &&
      operator === "=" &&
      right &&
      typeof right === "object" &&
      "val" in right;

    if (isIdComparison) {
      return right.val;
    }
  }

  return null;
}

/**
 * @Before("READ", "RequestApprovers")
 *
 * Narrows ApproverMatrix(...)/PendingApprovals beyond what the plain
 * CDS association (see PendingApprovals in db/schema.cds) can express
 * on its own:
 *
 * - The association already matches emailAddress and this row's own
 *   status = Pending Approval, but a MANAGED to-one association's
 *   on-condition can only be followed to its keys (a hard CDS
 *   compiler limitation, confirmed via a direct compile error:
 *   "Can follow managed association ... only to the keys of its
 *   target, not to 'status'"), so it cannot also require the PARENT
 *   Request to still be Pending Approval. Without this, a request
 *   that has since been fully Approved/Rejected/Completed keeps
 *   showing here forever, because nothing ever flips THIS SPECIFIC
 *   RequestApprovers row's own status once the request moves on past
 *   it (a level already actioned or superseded is left as a historical
 *   record, by design - see approve-reject-request.js).
 *
 * - For the same structural reason, it also cannot restrict to the
 *   SAME role this Approver Matrix row is for - an email address that
 *   holds more than one role (common in this dev/test tenant) would
 *   otherwise see every role's pending approvals mixed together under
 *   each of their Approver Matrix rows. RequestApprovers.userRole
 *   stores the role's DESCRIPTION text (see get-approvers-logic.js,
 *   userRole: role.descr), not its code, so the match here is against
 *   this Approver Matrix row's own resolved role descr.
 *
 * Only touches reads reached via this specific navigation - every
 * other read of RequestApprovers is left completely alone.
 *
 * @param {cds.Request} request
 */
module.exports = async function scopePendingApprovalsForApprover(request) {
  const select = request.query && request.query.SELECT;

  if (!select) {
    return;
  }

  const matched = isPendingApprovalsNavigation(select);

  /*
   * Unconditional diagnostic logging for every RequestApprovers read -
   * this scoping silently never took effect in production once
   * already (a wrong assumption about the CQN shape), so the actual
   * ref/params shape is logged every time rather than only on a
   * match, in case "matched" itself is still wrong.
   */
  LOG.info(
    "RequestApprovers read observed.",
    JSON.stringify({
      matched,
      ref: select.from?.ref,
      params: request.params,
    }),
  );

  if (!matched) {
    return;
  }

  const approverMatrixId =
    request.params?.[0]?.ID || extractParentKeyFromRef(select.from.ref);

  if (!approverMatrixId) {
    LOG.warn(
      "Could not resolve the Approver Matrix ID for this navigation - " +
        "forcing an empty result rather than showing unscoped data.",
      JSON.stringify({ ref: select.from?.ref, params: request.params }),
    );

    request.query.where({ ID: NO_MATCH_ID });

    return;
  }

  const tx = cds.tx(request);

  const { ApproverMatrix, RequestApprovers, Requests, UserRoles } =
    cds.entities(SERVICE_NAMESPACE);

  const approverMatrixRow = await tx.run(
    SELECT.one
      .from(ApproverMatrix)
      .columns("emailAddress", "userRole_code")
      .where({ ID: approverMatrixId }),
  );

  if (!approverMatrixRow) {
    request.query.where({ ID: NO_MATCH_ID });

    return;
  }

  const role = await tx.run(
    SELECT.one
      .from(UserRoles)
      .columns("descr")
      .where({ code: approverMatrixRow.userRole_code }),
  );

  const targetEmail = normalizeEmail(approverMatrixRow.emailAddress);
  const targetRole = normalizeRole(role?.descr);

  const candidateRows = await tx.run(
    SELECT.from(RequestApprovers)
      .columns("ID", "request_ID", "emailAddress", "userRole")
      .where({ status_code: APPROVER_STATUS.PENDING_APPROVAL }),
  );

  const matchingRows = candidateRows.filter(
    (row) =>
      normalizeEmail(row.emailAddress) === targetEmail &&
      normalizeRole(row.userRole) === targetRole,
  );

  if (!matchingRows.length) {
    LOG.info(
      "No matching pending approvals for Approver Matrix row.",
      JSON.stringify({ approverMatrixId, targetEmail, targetRole }),
    );

    request.query.where({ ID: NO_MATCH_ID });

    return;
  }

  const candidateRequestIds = [
    ...new Set(matchingRows.map((row) => row.request_ID)),
  ];

  const pendingRequestRows = await tx.run(
    SELECT.from(Requests)
      .columns("ID")
      .where({
        ID: { in: candidateRequestIds },
        status_code: REQUEST_STATUS.PENDING_APPROVAL,
      }),
  );

  const pendingRequestIds = new Set(pendingRequestRows.map((row) => row.ID));

  const allowedRowIds = matchingRows
    .filter((row) => pendingRequestIds.has(row.request_ID))
    .map((row) => row.ID);

  LOG.info(
    "Scoped ApproverMatrix Pending Approvals.",
    JSON.stringify({
      approverMatrixId,
      targetEmail,
      targetRole,
      candidateRows: matchingRows.length,
      allowed: allowedRowIds.length,
    }),
  );

  request.query.where(
    allowedRowIds.length
      ? { ID: { in: allowedRowIds } }
      : { ID: NO_MATCH_ID },
  );
};
