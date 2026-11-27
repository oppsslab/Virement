"use strict";

const cds = require("@sap/cds");

const {
  completeEarmarkedFundsAfterRejection,
} = require("./utils/earmarked-funds-rejection");
const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("complete-rejected-earmarked-funds-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const REQUEST_TYPE_VIREMENT = "T";

function resolveRequestId(request) {
  return request.params?.[0]?.ID || request.data?.ID || null;
}

/**
 * @On("completeRejectedEarmarkedFunds")
 *
 * Admin-only. Completes the Earmarked Funds document of a REJECTED
 * Virement whose document is still open in S/4 - requests rejected
 * before completion-on-rejection existed, or where that automatic
 * attempt failed. Safe to press again: a document that is already
 * complete is left alone.
 *
 * The role restriction is enforced by service.cds (@requires and the
 * Requests @restrict grant); the button's visibility rule in
 * annotations.cds is only a convenience.
 *
 * @param {cds.Request} request
 */
module.exports = async function completeRejectedEarmarkedFunds(request) {
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
      .columns(
        "ID",
        "status_code",
        "requestType_code",
        "earmarkedFundsDocNumber",
      )
      .where({ ID: requestId }),
  );

  if (!requestRow) {
    request.error(404, `Request ${requestId} was not found.`);

    return;
  }

  if (
    requestRow.requestType_code !== REQUEST_TYPE_VIREMENT ||
    requestRow.status_code !== REQUEST_STATUS.REJECTED
  ) {
    request.error(
      409,
      "Earmarked Funds can only be completed this way for a Rejected Virement request.",
    );

    return;
  }

  if (!requestRow.earmarkedFundsDocNumber) {
    request.error(
      409,
      "This request has no Earmarked Funds document to complete.",
    );

    return;
  }

  /*
   * Nothing was written; release this transaction before the helper
   * opens its own, so the history row it records is kept even when S/4
   * rejects the completion.
   */
  await tx.commit();

  const result = await completeEarmarkedFundsAfterRejection({
    requestId,
    requestRow,
  });

  LOG.info(
    "Manual Earmarked Funds completion for a rejected request.",
    JSON.stringify({
      requestId,
      documentNumber: result.documentNumber,
      outcome: result.outcome,
      triggeredBy: request.user?.id,
    }),
  );

  if (result.outcome === "failed") {
    request.warn(
      `Earmarked Funds document ${result.documentNumber} could not be marked complete: ${result.message}`,
    );
  } else if (result.outcome === "already-complete") {
    request.info(
      `Earmarked Funds document ${result.documentNumber} is already marked complete.`,
    );
  } else if (result.outcome === "completed") {
    request.info(
      `Earmarked Funds document ${result.documentNumber} has been marked complete.`,
    );
  } else {
    request.warn("This request has no Earmarked Funds document to complete.");
  }

  return cds.tx((freshTx) =>
    freshTx.run(SELECT.one.from(Requests).where({ ID: requestId })),
  );
};
