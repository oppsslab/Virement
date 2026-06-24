const cds = require("@sap/cds");
const { calculateTotalAmount } = require("./utils/requests-calculation-utils");
const { getLocalDateParts } = require("./utils/date-utils");
const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("requests-before-create-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const SEMANTIC_OBJECT_ACTION = "virementzuippsvirement-display";
const MAX_SEQUENCE = 999999;

/* ------------------------------------------------------------------ *
 * URL helpers
 * ------------------------------------------------------------------ */

function getAppBaseUrl(request) {
  const headers = request.headers || request.http?.req?.headers || {};

  const referer = headers.referer || headers.referrer;
  if (referer) {
    const base = referer.split("#")[0].replace(/\/$/, "");
    LOG.info("Base URL derived from Referer:", base);
    return base;
  }

  const forwardedProto =
    headers["x-forwarded-proto"] ||
    headers["x-forwarded-protocol"] ||
    request.http?.req?.protocol ||
    "https";

  const forwardedHost =
    headers["x-forwarded-host"] ||
    headers["host"] ||
    request.http?.req?.headers?.host;

  if (forwardedHost) {
    const base = `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");
    LOG.info("Base URL derived from forwarded/host headers:", base);
    return base;
  }

  const origin = headers.origin;
  if (origin) {
    const base = origin.replace(/\/$/, "");
    LOG.info("Base URL derived from Origin:", base);
    return base;
  }

  LOG.warn("Could not determine app base URL from request headers.");
  return "";
}

function generateRequestLink(request, requestId) {
  const appBaseUrl = getAppBaseUrl(request);
  const requestHash = `#${SEMANTIC_OBJECT_ACTION}&/Requests(ID=${requestId},IsActiveEntity=true)`;

  if (!appBaseUrl) {
    LOG.warn("App base URL unavailable. Storing hash-only request link.");
    return requestHash;
  }

  return `${appBaseUrl}${requestHash}`;
}

/* ------------------------------------------------------------------ *
 * Aging helpers
 * ------------------------------------------------------------------ */

function calculateAgingDays(lastActionDate, currentDate = new Date()) {
  if (!lastActionDate) {
    return 0;
  }

  const last = new Date(lastActionDate);
  const current = new Date(currentDate);

  last.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);

  const diffMs = current.getTime() - last.getTime();
  return Math.max(0, Math.floor(diffMs / 86400000));
}

async function calculateAging({ tx, RequestHistory, requestId }) {
  if (!RequestHistory) {
    return 0;
  }

  const latestHistory = await tx.run(
    SELECT.one
      .from(RequestHistory)
      .columns("date", "time")
      .where({ request_ID: requestId })
      .orderBy("date desc", "time desc"),
  );

  LOG.info("Latest history:", JSON.stringify(latestHistory || {}));

  if (!latestHistory?.date) {
    return 0;
  }

  return calculateAgingDays(latestHistory.date, new Date());
}

/* ------------------------------------------------------------------ *
 * Request number generation
 * ------------------------------------------------------------------ */

function parseSequence(requestNumber, prefix) {
  if (!requestNumber || !requestNumber.startsWith(prefix)) {
    return null;
  }

  const sequencePart = requestNumber.substring(prefix.length);
  if (!/^\d+$/.test(sequencePart)) {
    return null;
  }

  const sequenceNumber = parseInt(sequencePart, 10);
  return Number.isNaN(sequenceNumber) ? null : sequenceNumber;
}

async function generateRequestNumber({
  tx,
  Requests,
  requestTypeCode,
  fiscalYear,
  request,
}) {
  const fiscalYearString = String(fiscalYear);

  if (!/^\d{4}$/.test(fiscalYearString)) {
    LOG.error("Invalid fiscalYear:", fiscalYearString);
    request.error(400, "Fiscal Year must be a 4-digit year.");
    return null;
  }

  const fiscalYearLastTwoDigits = fiscalYearString.slice(-2);
  const requestNumberPrefix = `${requestTypeCode}${fiscalYearLastTwoDigits}`;

  LOG.info("Request number prefix:", requestNumberPrefix);

  const existingRequests = await tx.run(
    SELECT.from(Requests).columns("requestNumber")
      .where`requestNumber like ${requestNumberPrefix + "%"}`,
  );

  LOG.info(
    "Existing active request numbers:",
    JSON.stringify(existingRequests || []),
  );

  let maxSequence = 0;

  for (const row of existingRequests || []) {
    const sequenceNumber = parseSequence(
      row.requestNumber,
      requestNumberPrefix,
    );

    if (sequenceNumber === null) {
      LOG.warn(
        "Skipping requestNumber with invalid sequence:",
        row.requestNumber,
      );
      continue;
    }

    if (sequenceNumber > maxSequence) {
      maxSequence = sequenceNumber;
    }
  }

  let nextSequence = maxSequence + 1;

  if (nextSequence > MAX_SEQUENCE) {
    LOG.error("Maximum sequence exceeded for prefix:", requestNumberPrefix);
    request.error(
      400,
      `Maximum request number sequence exceeded for ${requestNumberPrefix}.`,
    );
    return null;
  }

  while (true) {
    const sequenceText = String(nextSequence).padStart(6, "0");
    const generatedRequestNumber = `${requestNumberPrefix}${sequenceText}`;

    LOG.info("Checking generated requestNumber:", generatedRequestNumber);

    const duplicate = await tx.run(
      SELECT.one
        .from(Requests)
        .columns("ID")
        .where({ requestNumber: generatedRequestNumber }),
    );

    if (!duplicate) {
      return generatedRequestNumber;
    }

    LOG.warn(
      "Duplicate requestNumber found, incrementing:",
      generatedRequestNumber,
    );

    nextSequence++;

    if (nextSequence > MAX_SEQUENCE) {
      LOG.error("Maximum sequence exceeded while checking duplicates.");
      request.error(
        400,
        `Maximum request number sequence exceeded for ${requestNumberPrefix}.`,
      );
      return null;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Validation helper
 * ------------------------------------------------------------------ */

function validateSubmission(
  request,
  { requestId, requestTypeCode, fiscalYear },
) {
  if (!requestId) {
    LOG.error("Request ID is missing.");
    request.error(400, "Request ID is required before creating the request.");
    return false;
  }

  if (!requestTypeCode) {
    LOG.error("requestType_code is missing.");
    request.error(400, "Request Type is required before creating the request.");
    return false;
  }

  if (!fiscalYear) {
    LOG.error("fiscalYear is missing.");
    request.error(400, "Fiscal Year is required before creating the request.");
    return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @Before(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE Requests started: submit calculations ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Incoming request.data:", JSON.stringify(request.data || {}));
    LOG.info("Request params:", JSON.stringify(request.params || []));

    request.data = request.data || {};

    const tx = cds.tx(request);
    const { Requests, RequestItems, RequestHistory } =
      cds.entities(SERVICE_NAMESPACE);

    if (!Requests) {
      LOG.error("Requests entity not found.");
      request.error(
        500,
        "Internal configuration error: Requests entity not found.",
      );
      return;
    }

    const requestId = request.data.ID;
    const requestTypeCode = request.data.requestType_code;
    const fiscalYear = request.data.fiscalYear;

    LOG.info("requestId:", requestId);
    LOG.info("requestType_code:", requestTypeCode);
    LOG.info("fiscalYear:", fiscalYear);

    if (
      !validateSubmission(request, { requestId, requestTypeCode, fiscalYear })
    ) {
      return;
    }

    // 1. Set submitted status → Pending Approval.
    request.data.status_code = REQUEST_STATUS.PENDING_APPROVAL;
    LOG.info("Set status_code to Pending Approval:", request.data.status_code);

    // 2. Set submission date & period.
    const dateParts = getLocalDateParts(new Date());
    request.data.submissionDate = dateParts.dateString;
    request.data.submissionPeriod = Number(dateParts.period); // 1

    LOG.info("Set submissionDate:", request.data.submissionDate);
    LOG.info("Set submissionPeriod:", request.data.submissionPeriod);

    // 3. Calculate total amount.
    request.data.totalAmount = await calculateTotalAmount({
      tx,
      RequestItems,
      requestId,
      request,
    });
    LOG.info("Calculated totalAmount:", request.data.totalAmount);

    // 4. Calculate aging.
    request.data.aging = await calculateAging({
      tx,
      RequestHistory,
      requestId,
    });
    LOG.info("Calculated aging:", request.data.aging);

    // 5. Generate request number if not present.
    if (!request.data.requestNumber) {
      const generatedRequestNumber = await generateRequestNumber({
        tx,
        Requests,
        requestTypeCode,
        fiscalYear,
        request,
      });

      if (!generatedRequestNumber) {
        return;
      }

      request.data.requestNumber = generatedRequestNumber;
      LOG.info("Generated requestNumber:", generatedRequestNumber);
    } else {
      LOG.info(
        "requestNumber already exists. Skipping generation:",
        request.data.requestNumber,
      );
    }

    // 6. Generate full UI deep link.
    request.data.requestLink = generateRequestLink(request, requestId);
    LOG.info("Generated requestLink:", request.data.requestLink);

    LOG.info("Final request.data:", JSON.stringify(request.data || {}));
    LOG.info("--- BEFORE CREATE Requests ended successfully ---");
  } catch (error) {
    LOG.error("Unexpected error during submit calculations.", error);
    request.error(
      500,
      "An unexpected error occurred while submitting the request.",
    );
  }
};
