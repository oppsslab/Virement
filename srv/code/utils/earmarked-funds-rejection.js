"use strict";

const cds = require("@sap/cds");

const {
  completeEarmarkedFundsDocument,
  getEarmarkedFundsDocumentStatus,
} = require("./earmarked-funds");
const { formatLocalDate, formatLocalTime } = require("./date-utils");
const { buildMessage } = require("./history-messages");

const LOG = cds.log("earmarked-funds-rejection");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const REQUEST_TYPE_TRANSFER = "T";

const SYSTEM_IDENTITY = "System";

/* RequestHistory.changes is String(500). */
const HISTORY_MAX_LENGTH = 500;

/**
 * Completes a rejected Virement's Earmarked Funds document, so the
 * budget it reserved at submission is not left blocked. A rejected
 * request cannot be reopened in the app, so nothing else would ever
 * close that document.
 *
 * Call this only AFTER the rejection has been committed. It is
 * best-effort and never throws: an S/4 failure must not undo or block
 * a rejection. A failure is logged and written to the request history
 * for manual follow-up, and reported back so the caller can warn the
 * user.
 *
 * Runs in its own transaction, because the caller's request
 * transaction is already committed by this point (the destination name
 * lookup and the history insert both need a live one).
 *
 * @param {object} params
 * @param {string} params.requestId
 * @param {object} params.requestRow - must carry requestType_code and
 *   earmarkedFundsDocNumber. Anything other than a Virement with a
 *   document (e.g. Project Virement, which never creates one) is
 *   skipped.
 * @returns {Promise<{
 *   outcome: "skipped"|"completed"|"already-complete"|"failed",
 *   documentNumber?: string,
 *   message?: string
 * }>}
 */
async function completeEarmarkedFundsAfterRejection({ requestId, requestRow }) {
  const requestType = String(requestRow?.requestType_code || "")
    .trim()
    .toUpperCase();

  const documentNumber = requestRow?.earmarkedFundsDocNumber;

  if (requestType !== REQUEST_TYPE_TRANSFER || !documentNumber) {
    return { outcome: "skipped" };
  }

  let result;

  try {
    await cds.tx(async () => {
      const { isCompleted } = await getEarmarkedFundsDocumentStatus({
        documentNumber,
      });

      if (isCompleted) {
        result = { outcome: "already-complete", documentNumber };

        return;
      }

      await completeEarmarkedFundsDocument({ documentNumber });

      result = { outcome: "completed", documentNumber };
    });
  } catch (error) {
    result = { outcome: "failed", documentNumber, message: error.message };

    LOG.error(
      "Request was rejected, but its Earmarked Funds document could not " +
        "be marked complete. It still holds budget - manual follow-up " +
        "is required.",
      JSON.stringify({ requestId, documentNumber, message: error.message }),
    );
  }

  if (result.outcome === "already-complete") {
    return result;
  }

  const history =
    result.outcome === "completed"
      ? buildMessage.earmarkedFundsCompletedOnRejection(documentNumber)
      : buildMessage.earmarkedFundsCompletionFailedOnRejection(
          documentNumber,
          result.message,
        );

  try {
    await cds.tx(async (tx) => {
      const { RequestHistory } = cds.entities(SERVICE_NAMESPACE);

      const now = new Date();

      await tx.run(
        INSERT.into(RequestHistory).entries({
          request_ID: requestId,
          date: formatLocalDate(now),
          time: formatLocalTime(now),
          changedBy: SYSTEM_IDENTITY,
          changes: history.slice(0, HISTORY_MAX_LENGTH),
        }),
      );
    });
  } catch (error) {
    LOG.error(
      "Could not write the Earmarked Funds outcome to request history.",
      JSON.stringify({ requestId, history, message: error.message }),
    );
  }

  return result;
}

module.exports = { completeEarmarkedFundsAfterRejection };
