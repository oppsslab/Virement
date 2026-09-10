"use strict";

const cds = require("@sap/cds");

const {
  completeEarmarkedFundsDocument,
  getEarmarkedFundsDocumentStatus,
} = require("./utils/earmarked-funds");

const insertRequestHistory = require("./insert-request-history");

const LOG = cds.log("retry-earmarked-funds-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

function resolveRequestId(request) {
  return request.params?.[0]?.ID || request.data?.ID || null;
}

/**
 * @On("retryEarmarkedFundsCompletion")
 *
 * Manually retries completing this request's Earmarked Funds
 * document, for when the best-effort attempt made during
 * approveRequest (see approve-reject-request.js) failed and was only
 * logged, never surfaced or retried automatically.
 *
 * @param {cds.Request} request
 */
module.exports = async function retryEarmarkedFundsCompletion(request) {
  const requestId = resolveRequestId(request);

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");

    return;
  }

  const tx = cds.tx(request);

  const { Requests } = cds.entities(SERVICE_NAMESPACE);

  const requestRow = await tx.run(
    SELECT.one
      .from(Requests)
      .columns("ID", "earmarkedFundsDocNumber")
      .where({ ID: requestId }),
  );

  if (!requestRow) {
    request.error(404, `Request ${requestId} was not found.`);

    return;
  }

  const { earmarkedFundsDocNumber } = requestRow;

  if (!earmarkedFundsDocNumber) {
    request.error(
      409,
      "This request has no Earmarked Funds document to complete.",
    );

    return;
  }

  const { isCompleted } = await getEarmarkedFundsDocumentStatus({
    documentNumber: earmarkedFundsDocNumber,
  });

  if (isCompleted) {
    request.info(
      `Earmarked Funds document ${earmarkedFundsDocNumber} is already marked complete.`,
    );

    return tx.run(SELECT.one.from(Requests).where({ ID: requestId }));
  }

  try {
    await completeEarmarkedFundsDocument({ documentNumber: earmarkedFundsDocNumber });
  } catch (error) {
    LOG.error(
      "Manual retry: Earmarked Funds document could not be marked complete.",
      JSON.stringify({
        requestId,
        earmarkedFundsDocNumber,
        message: error.message,
        detail: error.detail,
      }),
    );

    request.error(
      error.statusCode || 502,
      error.message ||
        "The Earmarked Funds document could not be marked complete.",
    );

    return;
  }

  await insertRequestHistory(
    request,
    requestId,
    `Earmarked Funds document ${earmarkedFundsDocNumber} was manually marked complete by ${request.user?.id || "system"}.`,
  );

  LOG.info(
    "Earmarked Funds document marked complete via manual retry.",
    JSON.stringify({ requestId, earmarkedFundsDocNumber }),
  );

  request.info(
    `Earmarked Funds document ${earmarkedFundsDocNumber} has been marked complete.`,
  );

  return tx.run(SELECT.one.from(Requests).where({ ID: requestId }));
};
