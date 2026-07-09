const cds = require("@sap/cds");
const { calculateAmountsByType } = require("./utils/requests-calculation-utils");
const { getLocalDateParts } = require("./utils/date-utils");
const { REQUEST_STATUS } = require("./utils/request-status");

const LOG = cds.log("requests-before-create-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const SEMANTIC_OBJECT_ACTION = "virementzuippsvirement-display";
const MAX_SEQUENCE = 999999;

/*
 * Role names used for transfer classification.
 */
const ROLE_JKEW = "MASS_UPLOAD_ALL";
const ROLE_FUNCTIONAL = "MASS_UPLOAD_TRANSFER";

/* ------------------------------------------------------------------ *
 * Role helpers
 * ------------------------------------------------------------------ */

function hasRole(user, roleName) {
  if (!user || !roleName) {
    return false;
  }

  const normalizedRoleName = String(roleName).trim().toUpperCase();

  /*
   * Preferred CAP-style role check.
   */
  if (typeof user.is === "function" && user.is(normalizedRoleName)) {
    return true;
  }

  /*
   * Fallback: roles as array.
   */
  if (Array.isArray(user.roles)) {
    return user.roles.some(function (role) {
      return String(role || "").trim().toUpperCase() === normalizedRoleName;
    });
  }

  /*
   * Fallback: roles as object.
   * Example:
   * {
   *   MASS_UPLOAD_ALL: true
   * }
   */
  if (user.roles && typeof user.roles === "object") {
    return Object.keys(user.roles).some(function (role) {
      return (
        String(role || "").trim().toUpperCase() === normalizedRoleName &&
        user.roles[role] === true
      );
    });
  }

  return false;
}

function getUserRoleFlags(user) {
  return {
    isJKEW:
      hasRole(user, ROLE_JKEW),

    isFunctional:
      hasRole(user, ROLE_FUNCTIONAL),
  };
}

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
 * Transfer category / request number helpers
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

/**
 * Determines the persisted transferCategory for Transfer requests.
 *
 * Rules:
 *   T + JKEW role       -> J
 *   T + Functional role -> F
 *   T + budgetType P    -> P
 *   T + budgetType N    -> N
 *
 * Priority:
 *   JKEW > Functional > Budget Type
 *
 * @param {cds.Request} request
 * @param {string} requestTypeCode
 * @param {string} budgetTypeCode
 * @param {{isJKEW: boolean, isFunctional: boolean}} roleFlags
 * @returns {string|null}
 */
function determineTransferCategory(
  request,
  requestTypeCode,
  budgetTypeCode,
  roleFlags,
) {
  const type = String(requestTypeCode || "").trim().toUpperCase();
  const budgetType = String(budgetTypeCode || "").trim().toUpperCase();

  if (type !== "T") {
    return null;
  }

  if (roleFlags.isJKEW) {
    return "J";
  }

  if (roleFlags.isFunctional) {
    return "F";
  }

  if (budgetType === "P") {
    return "P";
  }

  if (budgetType === "N") {
    return "N";
  }

  LOG.error(
    "Unable to determine transferCategory. budgetType_code:",
    budgetTypeCode,
  );

  request.error(
    400,
    "Budget Type must be P or N for Transfer requests without JKEW or Functional role.",
  );

  return null;
}

/**
 * Determines request number prefix.
 *
 * Rules:
 *   R request type -> R
 *   S request type -> S
 *   T request type -> transferCategory
 *
 * @param {cds.Request} request
 * @param {string} requestTypeCode
 * @param {string|null} transferCategory
 * @returns {string|null}
 */
function determineRequestNumberPrefixCode(
  request,
  requestTypeCode,
  transferCategory,
) {
  const type = String(requestTypeCode || "").trim().toUpperCase();

  if (type === "R") {
    return "R";
  }

  if (type === "S") {
    return "S";
  }

  if (type === "T") {
    const category = String(transferCategory || "").trim().toUpperCase();

    if (["J", "F", "P", "N"].includes(category)) {
      return category;
    }

    LOG.error("Invalid transferCategory for Transfer request:", transferCategory);

    request.error(
      400,
      "Transfer Category must be J, F, P, or N for Transfer requests.",
    );

    return null;
  }

  LOG.error("Unsupported requestType_code for request number:", requestTypeCode);

  request.error(
    400,
    "Request Type must be R, S, or T to generate a request number.",
  );

  return null;
}

async function generateRequestNumber({
  tx,
  Requests,
  requestTypeCode,
  transferCategory,
  fiscalYear,
  request,
}) {
  const fiscalYearString = String(fiscalYear);

  if (!/^\d{4}$/.test(fiscalYearString)) {
    LOG.error("Invalid fiscalYear:", fiscalYearString);
    request.error(400, "Fiscal Year must be a 4-digit year.");
    return null;
  }

  const prefixCode = determineRequestNumberPrefixCode(
    request,
    requestTypeCode,
    transferCategory,
  );

  if (!prefixCode) {
    return null;
  }

  const fiscalYearLastTwoDigits = fiscalYearString.slice(-2);
  const requestNumberPrefix = `${prefixCode}${fiscalYearLastTwoDigits}`;

  LOG.info("Request number prefix:", requestNumberPrefix);

  const existingRequests = await tx.run(
    SELECT.from(Requests)
      .columns("requestNumber")
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
  {
    requestId,
    requestTypeCode,
    budgetTypeCode,
    fiscalYear,
    transferCategory,
  },
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

  const type = String(requestTypeCode || "").trim().toUpperCase();
  const budgetType = String(budgetTypeCode || "").trim().toUpperCase();

  if (type === "T") {
    if (!["J", "F", "P", "N"].includes(transferCategory)) {
      LOG.error("Invalid transferCategory:", transferCategory);

      request.error(
        400,
        "Transfer Category must be J, F, P, or N for Transfer requests.",
      );

      return false;
    }

    /*
     * If normal transfer, budgetType_code must still be valid.
     */
    if (["P", "N"].includes(transferCategory) && !["P", "N"].includes(budgetType)) {
      LOG.error("budgetType_code is invalid for normal Transfer:", budgetType);

      request.error(
        400,
        "Budget Type must be P or N for normal Transfer requests.",
      );

      return false;
    }
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @Before(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests")
 *
 * Performs calculations before the request is created:
 * - Sets status to Pending Approval
 * - Sets submission date and period
 * - Determines and persists transferCategory for Transfer requests
 * - Calculates all amount fields
 * - Calculates aging
 * - Generates request number
 * - Generates request link
 *
 * Request number prefix rules:
 * - RequestType R -> R
 * - RequestType S -> S
 * - RequestType T + transferCategory J -> J
 * - RequestType T + transferCategory F -> F
 * - RequestType T + transferCategory P -> P
 * - RequestType T + transferCategory N -> N
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE Requests started ---");

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
    const budgetTypeCode = request.data.budgetType_code;
    const fiscalYear = request.data.fiscalYear;

    const roleFlags = getUserRoleFlags(request.user);

    /*
     * Persisted transfer classification.
     * Only applies to Transfer requests.
     */
    const transferCategory = determineTransferCategory(
      request,
      requestTypeCode,
      budgetTypeCode,
      roleFlags,
    );

    if (requestTypeCode === "T" && !transferCategory) {
      return;
    }

    request.data.transferCategory = transferCategory;

    LOG.info("requestId:", requestId);
    LOG.info("requestType_code:", requestTypeCode);
    LOG.info("budgetType_code:", budgetTypeCode);
    LOG.info("fiscalYear:", fiscalYear);
    LOG.info("Role flags:", JSON.stringify(roleFlags));
    LOG.info("transferCategory:", request.data.transferCategory);

    if (
      !validateSubmission(request, {
        requestId,
        requestTypeCode,
        budgetTypeCode,
        fiscalYear,
        transferCategory,
      })
    ) {
      return;
    }

    // 1. Set submitted status -> Pending Approval.
    request.data.status_code = REQUEST_STATUS.PENDING_APPROVAL;
    LOG.info("Set status_code to Pending Approval:", request.data.status_code);

    // 2. Set submission date and period.
    const dateParts = getLocalDateParts(new Date());
    request.data.submissionDate = dateParts.dateString;
    request.data.submissionPeriod = Number(dateParts.period);

    LOG.info("Set submissionDate:", request.data.submissionDate);
    LOG.info("Set submissionPeriod:", request.data.submissionPeriod);

    // 3. Calculate all amount fields.
    const amounts = await calculateAmountsByType({
      tx,
      RequestItems,
      requestId,
      request,
    });

    request.data.supplementAmount = amounts.supplementAmount;
    request.data.returnAmount = amounts.returnAmount;
    request.data.transferInAmount = amounts.transferInAmount;
    request.data.transferOutAmount = amounts.transferOutAmount;

    LOG.info("Calculated amounts:", JSON.stringify(amounts));

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
        transferCategory,
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