"use strict";

const cds = require("@sap/cds");

const { performPostToS4, businessError } = require("./post-to-s4-logic");

const {
  completeEarmarkedFundsDocument,
  getEarmarkedFundsDocumentStatus,
} = require("./utils/earmarked-funds");

const { formatLocalDate, formatLocalTime } = require("./utils/date-utils");
const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const LOG = cds.log("retry-post-document-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/*
 * Every history entry this action writes is attributed to this fixed
 * support identity, never to the admin who actually pressed the
 * button - this is a support-operated remediation for requests left
 * "Completed" without ever being posted to S/4 (see the syncOnly
 * fallback in approve-reject-request.js), so the audit trail should
 * read as a deliberate support intervention on the request's own
 * behalf, not as if an admin personally approved/posted it.
 */
const SUPPORT_IDENTITY = "virement_support@epf.gov.my";

function resolveRequestId(request) {
  return request.params?.[0]?.ID || request.data?.ID || null;
}

async function writeSupportHistory(tx, requestId, message) {
  const { RequestHistory } = cds.entities(SERVICE_NAMESPACE);
  const now = new Date();

  await tx.run(
    INSERT.into(RequestHistory).entries({
      request_ID: requestId,
      date: formatLocalDate(now),
      time: formatLocalTime(now),
      changedBy: SUPPORT_IDENTITY,
      changes: message,
    }),
  );
}

/**
 * @On("retryPostDocument")
 *
 * Admin-only manual remediation for a request marked "Completed"
 * (status_code 3) that was never actually posted to S/4 - the
 * syncOnly bypass in approve-reject-request.js (used when BPA cannot
 * confirm the approval task) previously skipped performPostToS4 and
 * completeEarmarkedFundsDocument entirely, so the approval was
 * recorded but no Transfer/Supplement/Return document was ever
 * created and no Earmarked Funds document was ever finalized. That
 * bypass now still posts to S/4 (fixed), but requests approved before
 * the fix (e.g. N26000036, N26000037) need this one-time retry.
 *
 * Reuses performPostToS4 directly, which is already idempotent - it
 * throws a 409 "already posted" error if every applicable document
 * number is already set - so pressing this on a request that was
 * already posted is a safe no-op error, never a duplicate posting.
 *
 * @param {cds.Request} request
 */
module.exports = async function retryPostDocument(request) {
  const requestId = resolveRequestId(request);

  if (!requestId) {
    request.error(400, "Unable to determine the request to act on.");

    return;
  }

  const tx = cds.tx(request);

  const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  const requestRow = await tx.run(
    SELECT.one
      .from(Requests)
      .columns(
        "ID",
        "status_code",
        "requestType_code",
        "earmarkedFundsDocNumber",
        "transferOutDocNumber",
        "transferInDocNumber",
      )
      .where({ ID: requestId }),
  );

  if (!requestRow) {
    request.error(404, `Request ${requestId} was not found.`);

    return;
  }

  if (requestRow.status_code !== REQUEST_STATUS.APPROVED) {
    request.error(
      409,
      "This request is not in a Completed state, so there is nothing to retry posting for.",
    );

    return;
  }

  /*
   * Explicit, user-facing guard on top of performPostToS4's own
   * generic "already posted" check: this action is only meant for a
   * Transfer request whose document was never posted at all, not a
   * normal already-posted request someone pressed this on by mistake.
   */
  if (requestRow.transferOutDocNumber || requestRow.transferInDocNumber) {
    request.error(
      409,
      "The Transfer Out & In Document Number is already set - this request has already been posted to S/4.",
    );

    return;
  }

  /*
   * The actual human approver (actionDate set distinguishes the
   * approver who really acted from auto-resolved siblings - see
   * approve-reject-request.js) is used as performPostToS4's
   * emailAddress, so Requests.approvedBy keeps recording the real
   * approver rather than being overwritten with the support identity.
   */
  const lastApprover = await tx.run(
    SELECT.one
      .from(RequestApprovers)
      .columns("emailAddress")
      .where({
        request_ID: requestId,
        status_code: APPROVER_STATUS.APPROVED,
        actionDate: { "!=": null },
      })
      .orderBy("level desc"),
  );

  const approverEmail = lastApprover?.emailAddress || SUPPORT_IDENTITY;

  let s4Result;

  try {
    s4Result = await performPostToS4({
      tx,
      request,
      requestId,
      emailAddress: approverEmail,
    });
  } catch (error) {
    const safe = businessError(error);

    LOG.error(
      "Manual retry: S/4 posting failed.",
      JSON.stringify({ requestId, message: error.message, status: safe.status }),
    );

    request.error(safe.status, safe.message);

    return;
  }

  const documentNumbers = Object.values(s4Result?.documentNumbers || {}).join(", ");

  await writeSupportHistory(
    tx,
    requestId,
    `Posting to S/4 was manually retried by ${SUPPORT_IDENTITY}: the ` +
      "original approval synced locally without posting because the " +
      `BPA workflow task could not be confirmed. Document number(s): ${documentNumbers}.`,
  );

  LOG.info(
    "Manual S/4 posting retry succeeded.",
    JSON.stringify({ requestId, documentNumbers: s4Result.documentNumbers }),
  );

  if (s4Result?.documentNumbers?.TRAN && s4Result?.earmarkedFundsDocNumber) {
    const { isCompleted } = await getEarmarkedFundsDocumentStatus({
      documentNumber: s4Result.earmarkedFundsDocNumber,
    });

    if (isCompleted) {
      await writeSupportHistory(
        tx,
        requestId,
        `Earmarked Funds document ${s4Result.earmarkedFundsDocNumber} was already marked complete.`,
      );
    } else {
      try {
        await completeEarmarkedFundsDocument({
          documentNumber: s4Result.earmarkedFundsDocNumber,
        });

        await writeSupportHistory(
          tx,
          requestId,
          `Earmarked Funds document ${s4Result.earmarkedFundsDocNumber} was marked complete by ${SUPPORT_IDENTITY} as part of the manual posting retry.`,
        );

        LOG.info(
          "Manual retry: Earmarked Funds document marked complete.",
          JSON.stringify({ requestId, earmarkedFundsDocNumber: s4Result.earmarkedFundsDocNumber }),
        );
      } catch (error) {
        LOG.error(
          "Manual retry: S/4 posting succeeded but Earmarked Funds completion failed.",
          JSON.stringify({
            requestId,
            earmarkedFundsDocNumber: s4Result.earmarkedFundsDocNumber,
            message: error.message,
          }),
        );

        await writeSupportHistory(
          tx,
          requestId,
          `Posting to S/4 succeeded (document ${documentNumbers}), but the Earmarked Funds document ${s4Result.earmarkedFundsDocNumber} could not be marked complete: ${error.message} Retry Earmarked Funds completion separately.`,
        );

        request.info(
          `Transfer document posted to S/4 (${documentNumbers}), but the Earmarked Funds document could not be marked complete: ${error.message}`,
        );

        return tx.run(SELECT.one.from(Requests).where({ ID: requestId }));
      }
    }
  }

  request.info(`Document posted to S/4 successfully: ${documentNumbers}.`);

  return tx.run(SELECT.one.from(Requests).where({ ID: requestId }));
};
