const cds = require("@sap/cds");
const { formatLocalDate, formatLocalTime } = require("./utils/date-utils");

const LOG = cds.log("insert-request-history");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * Inserts a RequestHistory entry for the given request.
 *
 * Non-fatal: logs and returns false on failure WITHOUT raising
 * request.error(), so a history failure never rolls back the
 * main business transaction.
 *
 * @param {cds.Request} request
 * @param {string} requestId
 * @param {string} message
 * @returns {Promise<boolean>} true if inserted, false otherwise
 */
module.exports = async function insertRequestHistory(
  request,
  requestId,
  message,
) {
  LOG.info("--- Insert RequestHistory started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Request ID:", requestId);
    LOG.info("Message:", message);

    if (!requestId) {
      LOG.warn("Request ID is missing. Skipping RequestHistory insert.");
      return false;
    }

    if (!message) {
      LOG.warn("History message is missing. Skipping RequestHistory insert.");
      return false;
    }

    const { RequestHistory } = cds.entities(SERVICE_NAMESPACE);

    if (!RequestHistory) {
      LOG.error("RequestHistory entity not found. Skipping insert.");
      return false;
    }

    const tx = cds.tx(request);
    const now = new Date();

    const historyEntry = {
      request_ID: requestId,
      date: formatLocalDate(now),
      time: formatLocalTime(now),
      changedBy: request.user?.id || "system",
      changes: message,
    };

    LOG.info("History entry to insert:", JSON.stringify(historyEntry));

    await tx.run(INSERT.into(RequestHistory).entries(historyEntry));

    LOG.info("RequestHistory inserted successfully.");
    LOG.info("--- Insert RequestHistory ended successfully ---");

    return true;
  } catch (error) {
    LOG.error("Failed to insert RequestHistory (non-fatal):", error);
    return false;
  }
};
