/**
 * Centralized RequestHistory messages.
 * Aligned to RequestStatusCode: Draft, Rejected, PendingApproval, Completed.
 */
const { REQUEST_STATUS_LABEL } = require("./request-status");

const HISTORY_MESSAGES = {
  // Submission (Draft → PendingApproval)
  SUBMITTED: "Virement has been submitted",

  // Approval flow
  APPROVED: "Virement has been approved",
  REJECTED: "Virement has been rejected",
  COMPLETED: "Virement has been completed",

  // Lifecycle
  CREATED: "Virement has been created",
  MODIFIED: "Virement has been modified",
};

const buildMessage = {
  approvedBy(user) {
    return `Virement has been approved by ${user || "approver"}`;
  },

  rejectedWithReason(reason) {
    return reason
      ? `Virement has been rejected. Reason: ${reason}`
      : HISTORY_MESSAGES.REJECTED;
  },

  earmarkedFundsCreated(documentNumber) {
    return `Earmarked Funds document ${documentNumber} has been created`;
  },

  earmarkedFundsCompletedOnRejection(documentNumber) {
    return `Earmarked Funds document ${documentNumber} has been marked complete by System`;
  },

  earmarkedFundsCompletionFailedOnRejection(documentNumber, reason) {
    return `Earmarked Funds document ${documentNumber} could NOT be marked complete after rejection and needs manual follow-up: ${reason || "unknown error"}`;
  },

  statusChangedTo(statusCode) {
    const label = REQUEST_STATUS_LABEL[statusCode] || `status ${statusCode}`;
    return `Virement status changed to ${label}`;
  },
};

module.exports = {
  HISTORY_MESSAGES,
  buildMessage,
};
