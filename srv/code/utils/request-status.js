/**
 * Centralized Request status codes.
 *
 * These MUST stay in sync with the RequestStatus entity codes
 * defined in your data model (db/csv).
 *
 * Keep ALL status codes here so they're documented in one place
 * and never hardcoded as magic numbers across handlers.
 */
const REQUEST_STATUS = {
  DRAFT: 0,
  PENDING_APPROVAL: 2,
  APPROVED: 3,
  REJECTED: 1,
  POSTED: 5,
};

const APPROVER_STATUS = {
  INACTIVE: 0,
  PENDING_APPROVAL: 2,
  APPROVED: 3,
  REJECTED: 1
};

/**
 * Human-readable labels (handy for logs / history messages).
 */
const REQUEST_STATUS_LABEL = {
  [REQUEST_STATUS.DRAFT]: "Draft",
  [REQUEST_STATUS.PENDING_APPROVAL]: "Pending Approval",
  [REQUEST_STATUS.APPROVED]: "Approved",
  [REQUEST_STATUS.REJECTED]: "Rejected",
  [REQUEST_STATUS.POSTED]: "Posted",
};

module.exports = {
  REQUEST_STATUS,
  REQUEST_STATUS_LABEL,
  APPROVER_STATUS
};
