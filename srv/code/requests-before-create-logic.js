const cds = require("@sap/cds");

const {
  calculateAmountsByType,
} = require("./utils/requests-calculation-utils");

const { getLocalDateParts } = require("./utils/date-utils");

const { REQUEST_STATUS } = require("./utils/request-status");

const {
  createEarmarkedFundsDocument,
} = require("./utils/earmarked-funds");

const { findExistingCostCentres } = require("./utils/cost-centers");

const LOG = cds.log("requests-before-create-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const SEMANTIC_OBJECT_ACTION = "virementzuippsvirement-display";

/*
 * sap-ui-app-id-hint required by the Fiori Launchpad to resolve
 * the correct app when opening the deep link.
 */
const SAP_UI_APP_ID_HINT = "saas_approuter_virement.zuippsvirement";

const MAX_SEQUENCE = 999999;

/*
 * Role names used for transfer classification.
 */
const ROLE_JKEW = "MASS_UPLOAD_ALL";
const ROLE_FUNCTIONAL = "MASS_UPLOAD_TRANSFER";

/*
 * Request type code for Supplement requests.
 * WBS validation for Project budget type only applies to this type.
 */
const REQUEST_TYPE_SUPPLEMENT = "S";

/*
 * Request type code for Virement (Transfer) requests.
 * A Virement carrying a transfer-out amount reserves funds in S/4 via the
 * Earmarked Funds API at submit time.
 */
const REQUEST_TYPE_TRANSFER = "T";

/*
 * Budget type code that represents "Project" budget requests.
 * WBS is mandatory on all Request Items when this budget type is used
 * on a Supplement (S) request.
 */
const BUDGET_TYPE_PROJECT = "P";

/*
 * Number of leading characters that must match between
 * Material and GL Account. Applies to all request types.
 */
const MATERIAL_GL_MATCH_LENGTH = 6;

/*
 * Maximum amount allowed on Project budget type requests:
 *   - Virement (T): total Transfer Out Amount
 *   - Supplement (S): total Supplement Amount
 * Non Project requests of either type are unaffected.
 */
const MAX_PROJECT_BUDGET_AMOUNT = 5000000;

/* ------------------------------------------------------------------ *
 * Role helpers
 * ------------------------------------------------------------------ */

/**
 * Determines whether the logged-in user has the specified role.
 *
 * Supports:
 * - CAP user.is(...)
 * - user.roles as an array
 * - user.roles as an object
 *
 * @param {object} user
 * @param {string} roleName
 * @returns {boolean}
 */
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
   *
   * Example:
   * [
   *   "MASS_UPLOAD_ALL",
   *   "OTHER_ROLE"
   * ]
   */
  if (Array.isArray(user.roles)) {
    return user.roles.some(function (role) {
      return (
        String(role || "")
          .trim()
          .toUpperCase() === normalizedRoleName
      );
    });
  }

  /*
   * Fallback: roles as object.
   *
   * Example:
   * {
   *   MASS_UPLOAD_ALL: true
   * }
   */
  if (user.roles && typeof user.roles === "object") {
    return Object.keys(user.roles).some(function (role) {
      return (
        String(role || "")
          .trim()
          .toUpperCase() === normalizedRoleName && user.roles[role] === true
      );
    });
  }

  return false;
}

/**
 * Returns role flags used for transfer classification.
 *
 * @param {object} user
 * @returns {{
 *   isJKEW: boolean,
 *   isFunctional: boolean
 * }}
 */
function getUserRoleFlags(user) {
  return {
    isJKEW: hasRole(user, ROLE_JKEW),
    isFunctional: hasRole(user, ROLE_FUNCTIONAL),
  };
}

/* ------------------------------------------------------------------ *
 * URL helpers
 * ------------------------------------------------------------------ */

/**
 * Determines the application base URL from the incoming request.
 *
 * Fiori Launchpad renders apps inside an iframe (ui5appruntime.html),
 * so the Referer header reflects that iframe's own URL - a long
 * runtime path with many query parameters (siteId, subaccountId,
 * saasApprouter, sap-ui-app-id, scenario, sap-theme, etc.) - not the
 * clean shell URL. This function extracts only the origin and the
 * siteId parameter from that Referer, then reconstructs the desired
 * "/site?siteId=..." shape, discarding everything else.
 *
 * @param {cds.Request} request
 * @returns {string}
 */
function getAppBaseUrl(request) {
  const headers = request.headers || request.http?.req?.headers || {};

  const referer = headers.referer || headers.referrer;

  if (referer) {
    try {
      const refererUrl = new URL(referer);

      const siteId = refererUrl.searchParams.get("siteId");

      if (siteId) {
        const base = `${refererUrl.origin}/site?siteId=${encodeURIComponent(siteId)}`;

        LOG.info("Base URL derived from Referer (siteId extracted):", base);

        return base;
      }

      /*
       * No siteId found in the Referer's query string. Fall back
       * to the origin only, stripping any path/query/hash, rather
       * than passing through the full iframe runtime URL.
       */
      const base = refererUrl.origin;

      LOG.warn(
        "Referer did not contain a siteId parameter. " +
          "Falling back to origin only:",
        base,
      );

      return base;
    } catch (error) {
      LOG.warn(
        "Failed to parse Referer as a URL. Falling back to " +
          "legacy split-on-hash logic.",
        JSON.stringify({ referer, message: error.message }),
      );

      const base = String(referer).split("#")[0].replace(/\/$/, "");

      return base;
    }
  }

  const forwardedProtoHeader =
    headers["x-forwarded-proto"] || headers["x-forwarded-protocol"];

  const forwardedProto = String(
    forwardedProtoHeader || request.http?.req?.protocol || "https",
  )
    .split(",")[0]
    .trim();

  const forwardedHostHeader =
    headers["x-forwarded-host"] ||
    headers.host ||
    request.http?.req?.headers?.host;

  const forwardedHost = forwardedHostHeader
    ? String(forwardedHostHeader).split(",")[0].trim()
    : "";

  if (forwardedHost) {
    const base = `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "");

    LOG.info("Base URL derived from forwarded/host headers:", base);

    return base;
  }

  const origin = headers.origin;

  if (origin) {
    const base = String(origin).replace(/\/$/, "");

    LOG.info("Base URL derived from Origin:", base);

    return base;
  }

  LOG.warn("Could not determine app base URL from request headers.");

  return "";
}

/**
 * Generates the UI deep link for the created request.
 *
 * Produces a link in the form:
 *
 *   {appBaseUrl}#{semanticObjectAction}
 *     ?sap-ui-app-id-hint={appIdHint}
 *     &/Requests(ID={requestId},IsActiveEntity=true)
 *
 * @param {cds.Request} request
 * @param {string} requestId
 * @returns {string}
 */
function generateRequestLink(request, requestId) {
  const appBaseUrl = getAppBaseUrl(request);

  const requestHash =
    `#${SEMANTIC_OBJECT_ACTION}` +
    `?sap-ui-app-id-hint=${SAP_UI_APP_ID_HINT}` +
    "&/Requests(" +
    `ID=${requestId},` +
    "IsActiveEntity=true" +
    ")";

  if (!appBaseUrl) {
    LOG.warn("App base URL unavailable. " + "Storing hash-only request link.");

    return requestHash;
  }

  return `${appBaseUrl}${requestHash}`;
}

/* ------------------------------------------------------------------ *
 * Request items helpers
 * ------------------------------------------------------------------ */

/**
 * Fetches the RequestItems associated with the request.
 *
 * Checks both:
 * - request.data.RequestItems (deep-insert payload)
 * - existing persisted RequestItems for the requestId
 *   (covers draft-pattern flows where items were already saved)
 *
 * @param {object} options
 * @param {object} options.tx
 * @param {object} options.RequestItems
 * @param {cds.Request} options.request
 * @param {string} options.requestId
 * @returns {Promise<object[]>}
 */
async function fetchRequestItems({ tx, RequestItems, request, requestId }) {
  const payloadItems = request.data.RequestItems;

  if (Array.isArray(payloadItems) && payloadItems.length > 0) {
    LOG.info(
      "RequestItems found in deep-insert payload. Count:",
      payloadItems.length,
    );

    return payloadItems;
  }

  if (!RequestItems || !requestId) {
    LOG.warn(
      "Cannot fetch persisted RequestItems. " +
        "RequestItems entity or requestId is missing.",
    );

    return [];
  }

  const persistedItems = await tx.run(
    SELECT.from(RequestItems)
      .columns(
        "ID",
        "wbs",
        "material",
        "glAccount",
        // Required to build the Earmarked Funds payload (see
        // utils/earmarked-funds.js). Harmless for the WBS / Material-GL
        // validations, which read only the fields above.
        "costCentre",
        "transferInAmount",
        "transferOutAmount",
        "description",
      )
      .where({
        request_ID: requestId,
      }),
  );

  LOG.info(
    "Persisted RequestItems fetched. Count:",
    (persistedItems || []).length,
  );

  return persistedItems || [];
}

/**
 * Validates that WBS is filled on every request item when the
 * request type is Supplement (S) and the budget type is
 * "Project" (P).
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @param {string} options.requestTypeCode
 * @param {string} options.budgetTypeCode
 * @returns {boolean}
 */
function validateWbsForProjectBudget(
  request,
  { items, requestTypeCode, budgetTypeCode },
) {
  const type = String(requestTypeCode || "")
    .trim()
    .toUpperCase();

  const budgetType = String(budgetTypeCode || "")
    .trim()
    .toUpperCase();

  if (type !== REQUEST_TYPE_SUPPLEMENT || budgetType !== BUDGET_TYPE_PROJECT) {
    return true;
  }

  const itemsMissingWbs = (items || []).filter(function (item) {
    return !String(item.wbs || "").trim();
  });

  if (itemsMissingWbs.length > 0) {
    const missingItemIds = itemsMissingWbs
      .map(function (item, index) {
        return item.ID || `#${index + 1}`;
      })
      .join(", ");

    LOG.error(
      "WBS is required for Supplement requests with Project budget " +
        "type. Missing on items:",
      missingItemIds,
    );

    request.error(
      400,
      "WBS is required for all Request Items when Request Type is " +
        "Supplement and Budget Type is Project.",
    );

    return false;
  }

  return true;
}

/**
 * Validates that the first digits of Material match the first
 * digits of GL Account on every request item. Applies to all
 * request types.
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @returns {boolean}
 */
function validateMaterialGlAlignment(request, { items }) {
  const mismatchedItems = (items || []).filter(function (item) {
    const material = String(item.material || "").trim();

    const glAccount = String(item.glAccount || "").trim();

    if (!material || !glAccount) {
      return false;
    }

    const materialPrefix = material.substring(0, MATERIAL_GL_MATCH_LENGTH);

    const glAccountPrefix = glAccount.substring(0, MATERIAL_GL_MATCH_LENGTH);

    return materialPrefix !== glAccountPrefix;
  });

  if (mismatchedItems.length > 0) {
    const mismatchedItemIds = mismatchedItems
      .map(function (item, index) {
        return item.ID || `#${index + 1}`;
      })
      .join(", ");

    LOG.error(
      "Material and GL Account first " +
        `${MATERIAL_GL_MATCH_LENGTH} digits do not match on items:`,
      mismatchedItemIds,
    );

    request.error(
      400,
      "The first " +
        `${MATERIAL_GL_MATCH_LENGTH} digits of Material must match ` +
        "the GL Account on all Request Items.",
    );

    return false;
  }

  return true;
}

/**
 * Validates that every Cost Centre on the request items is a real S/4
 * code. Applies to all request types.
 *
 * The value help only ever offers a real code, but a code can still
 * reach here by being typed directly or pasted in via the upload
 * template. Left unchecked it flows straight through to the S/4
 * posting call later in this handler, where an invalid FUNDCTR fails
 * far less clearly than it does here.
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @returns {Promise<boolean>}
 */
async function validateCostCentresExist(request, { items }) {
  const codesByItem = (items || [])
    .map(function (item, index) {
      return {
        id: item.ID || `#${index + 1}`,
        code: String(item.costCentre || "").trim(),
      };
    })
    .filter(function (entry) {
      return Boolean(entry.code);
    });

  if (!codesByItem.length) {
    return true;
  }

  const existingCodes = await findExistingCostCentres(
    codesByItem.map(function (entry) {
      return entry.code;
    }),
  );

  const invalidItems = codesByItem.filter(function (entry) {
    return !existingCodes.has(entry.code.toUpperCase());
  });

  if (invalidItems.length > 0) {
    const invalidCodes = [
      ...new Set(invalidItems.map(function (entry) {
        return entry.code;
      })),
    ].join(", ");

    const invalidItemIds = invalidItems
      .map(function (entry) {
        return entry.id;
      })
      .join(", ");

    LOG.error(
      "Cost Centre is not valid on items:",
      JSON.stringify({ invalidCodes, invalidItemIds }),
    );

    request.error(
      400,
      `Cost Centre ${invalidCodes} is not valid. Please select a Cost ` +
        "Centre from the search help.",
    );

    return false;
  }

  return true;
}

/**
 * Validates that no Request Item carries both a Transfer In Amount
 * and a Transfer Out Amount at the same time. Applies to Virement
 * (T) requests only.
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @param {string} options.requestTypeCode
 * @returns {boolean}
 */
function validateVirementTransferInOutExclusivity(
  request,
  { items, requestTypeCode },
) {
  const type = String(requestTypeCode || "").trim().toUpperCase();

  if (type !== REQUEST_TYPE_TRANSFER) {
    return true;
  }

  const conflictingItems = (items || []).filter(function (item) {
    return Number(item.transferInAmount) > 0 && Number(item.transferOutAmount) > 0;
  });

  if (conflictingItems.length > 0) {
    const conflictingItemIds = conflictingItems
      .map(function (item, index) {
        return item.ID || `#${index + 1}`;
      })
      .join(", ");

    LOG.error(
      "Transfer In Amount and Transfer Out Amount are both filled on " +
        "items:",
      conflictingItemIds,
    );

    request.error(
      400,
      "Transfer In Amount and Transfer Out Amount cannot both be filled " +
        "on the same Request Item.",
    );

    return false;
  }

  return true;
}

/**
 * Validates the number of Request Items carrying a Transfer In
 * Amount (min 1, max 5) and Transfer Out Amount (min 1, max 5) on
 * Virement (T) requests. Up to 5 distinct Transfer Out cost centers
 * matches the "Head of Transfer-out Cost Center" approver being
 * resolved per cost center in the approval routing (see
 * utils/virement-scenario.js).
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @param {string} options.requestTypeCode
 * @returns {boolean}
 */
function validateVirementItemCounts(request, { items, requestTypeCode }) {
  const type = String(requestTypeCode || "").trim().toUpperCase();

  if (type !== REQUEST_TYPE_TRANSFER) {
    return true;
  }

  const transferInCount = (items || []).filter(function (item) {
    return Number(item.transferInAmount) > 0;
  }).length;

  const transferOutCount = (items || []).filter(function (item) {
    return Number(item.transferOutAmount) > 0;
  }).length;

  if (transferInCount < 1 || transferInCount > 5) {
    LOG.error(
      "Invalid Transfer In line item count for Virement request:",
      transferInCount,
    );

    request.error(
      400,
      "A Virement request must have between 1 and 5 Request Items with " +
        "a Transfer In Amount.",
    );

    return false;
  }

  if (transferOutCount < 1 || transferOutCount > 5) {
    LOG.error(
      "Invalid Transfer Out line item count for Virement request:",
      transferOutCount,
    );

    request.error(
      400,
      "A Virement request must have between 1 and 5 Request Items with " +
        "a Transfer Out Amount.",
    );

    return false;
  }

  return true;
}

/**
 * Validates that the total Transfer Out Amount equals the total
 * Transfer In Amount across all Request Items. Applies to Virement
 * (T) requests only.
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {object[]} options.items
 * @param {string} options.requestTypeCode
 * @returns {boolean}
 */
function validateVirementAmountsBalance(request, { items, requestTypeCode }) {
  const type = String(requestTypeCode || "").trim().toUpperCase();

  if (type !== REQUEST_TYPE_TRANSFER) {
    return true;
  }

  const totalTransferIn = (items || []).reduce(function (sum, item) {
    return sum + Number(item.transferInAmount || 0);
  }, 0);

  const totalTransferOut = (items || []).reduce(function (sum, item) {
    return sum + Number(item.transferOutAmount || 0);
  }, 0);

  if (Math.abs(totalTransferIn - totalTransferOut) > 0.01) {
    LOG.error(
      "Transfer In / Out totals do not balance for Virement request:",
      JSON.stringify({ totalTransferIn, totalTransferOut }),
    );

    request.error(
      400,
      "Total Transfer Out Amount must equal Total Transfer In Amount.",
    );

    return false;
  }

  return true;
}

/**
 * Validates that the request-type-relevant total does not exceed
 * MAX_PROJECT_BUDGET_AMOUNT when Budget Type is Project (P):
 *   - Virement (T): total Transfer Out Amount
 *   - Supplement (S): total Supplement Amount
 *
 * Non Project requests, and request types other than Virement/
 * Supplement, are unaffected. Must run after the amounts have been
 * calculated (calculateAmountsByType), since it needs the final
 * totals rather than raw per-item values.
 *
 * @param {cds.Request} request
 * @param {object} options
 * @param {string} options.requestTypeCode
 * @param {string} options.budgetTypeCode
 * @param {object} options.amounts - the object returned by
 *   calculateAmountsByType ({supplementAmount, transferOutAmount, ...})
 * @returns {boolean}
 */
function validateMaxAmountForProjectBudget(
  request,
  { requestTypeCode, budgetTypeCode, amounts },
) {
  const type = String(requestTypeCode || "").trim().toUpperCase();

  const budgetType = String(budgetTypeCode || "").trim().toUpperCase();

  if (budgetType !== BUDGET_TYPE_PROJECT) {
    return true;
  }

  let total;

  let amountLabel;

  if (type === REQUEST_TYPE_TRANSFER) {
    total = Number(amounts.transferOutAmount) || 0;

    amountLabel = "Total Transfer Out Amount";
  } else if (type === REQUEST_TYPE_SUPPLEMENT) {
    total = Number(amounts.supplementAmount) || 0;

    amountLabel = "Total Supplement Amount";
  } else {
    return true;
  }

  if (total > MAX_PROJECT_BUDGET_AMOUNT) {
    LOG.error(
      `${amountLabel} exceeds the maximum allowed for Project budget type:`,
      total,
    );

    request.error(
      400,
      `${amountLabel} cannot exceed ${MAX_PROJECT_BUDGET_AMOUNT.toLocaleString("en-US")} for Project budget type.`,
    );

    return false;
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Transfer category and request-number helpers
 * ------------------------------------------------------------------ */

/**
 * Extracts the numeric sequence from a request number.
 *
 * @param {string} requestNumber
 * @param {string} prefix
 * @returns {number|null}
 */
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
 * @param {{
 *   isJKEW: boolean,
 *   isFunctional: boolean
 * }} roleFlags
 * @returns {string|null}
 */
function determineTransferCategory(
  request,
  requestTypeCode,
  budgetTypeCode,
  roleFlags,
) {
  const type = String(requestTypeCode || "")
    .trim()
    .toUpperCase();

  const budgetType = String(budgetTypeCode || "")
    .trim()
    .toUpperCase();

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
    "Unable to determine transferCategory. " + "budgetType_code:",
    budgetTypeCode,
  );

  request.error(
    400,
    "Budget Type must be P or N for Transfer " +
      "requests without JKEW or Functional role.",
  );

  return null;
}

/**
 * Determines the request-number prefix code.
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
  const type = String(requestTypeCode || "")
    .trim()
    .toUpperCase();

  if (type === "R") {
    return "R";
  }

  if (type === "S") {
    return "S";
  }

  if (type === "T") {
    const category = String(transferCategory || "")
      .trim()
      .toUpperCase();

    if (["J", "F", "P", "N"].includes(category)) {
      return category;
    }

    LOG.error(
      "Invalid transferCategory for Transfer request:",
      transferCategory,
    );

    request.error(
      400,
      "Transfer Category must be J, F, P, or N " + "for Transfer requests.",
    );

    return null;
  }

  LOG.error(
    "Unsupported requestType_code for request number:",
    requestTypeCode,
  );

  request.error(
    400,
    "Request Type must be R, S, or T " + "to generate a request number.",
  );

  return null;
}

/**
 * Generates the next request number.
 *
 * @param {object} options
 * @param {object} options.tx
 * @param {object} options.Requests
 * @param {string} options.requestTypeCode
 * @param {string|null} options.transferCategory
 * @param {number|string} options.fiscalYear
 * @param {cds.Request} options.request
 * @returns {Promise<string|null>}
 */
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
    SELECT.from(Requests).columns("requestNumber").where`
        requestNumber like ${requestNumberPrefix + "%"}
      `,
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
      "Maximum request number sequence " +
        `exceeded for ${requestNumberPrefix}.`,
    );

    return null;
  }

  while (nextSequence <= MAX_SEQUENCE) {
    const sequenceText = String(nextSequence).padStart(6, "0");

    const generatedRequestNumber = `${requestNumberPrefix}${sequenceText}`;

    LOG.info("Checking generated requestNumber:", generatedRequestNumber);

    const duplicate = await tx.run(
      SELECT.one.from(Requests).columns("ID").where({
        requestNumber: generatedRequestNumber,
      }),
    );

    if (!duplicate) {
      return generatedRequestNumber;
    }

    LOG.warn(
      "Duplicate requestNumber found, incrementing:",
      generatedRequestNumber,
    );

    nextSequence += 1;
  }

  LOG.error("Maximum sequence exceeded while checking duplicates.");

  request.error(
    400,
    "Maximum request number sequence " + `exceeded for ${requestNumberPrefix}.`,
  );

  return null;
}

/* ------------------------------------------------------------------ *
 * Validation helper
 * ------------------------------------------------------------------ */

/**
 * Validates the request before submission calculations.
 *
 * @param {cds.Request} request
 * @param {object} values
 * @param {string} values.requestId
 * @param {string} values.requestTypeCode
 * @param {string} values.budgetTypeCode
 * @param {string|number} values.fiscalYear
 * @param {string|null} values.transferCategory
 * @param {string|null} values.returnCategory
 * @returns {boolean}
 */
function validateSubmission(
  request,
  {
    requestId,
    requestTypeCode,
    budgetTypeCode,
    fiscalYear,
    transferCategory,
    returnCategory,
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

  const type = String(requestTypeCode || "")
    .trim()
    .toUpperCase();

  const budgetType = String(budgetTypeCode || "")
    .trim()
    .toUpperCase();

  if (!["R", "S", "T"].includes(type)) {
    LOG.error("Unsupported request type:", type);

    request.error(400, "Request Type must be R, S, or T.");

    return false;
  }

  if (type === "R" && !["Z", "C"].includes(returnCategory)) {
    LOG.error("Invalid returnCategory_code:", returnCategory);

    request.error(
      400,
      "Return Category must be Budget Zerorise or " +
        "Budget Return to Central Fund for Return requests.",
    );

    return false;
  }

  if (type === "T") {
    if (!["J", "F", "P", "N"].includes(transferCategory)) {
      LOG.error("Invalid transferCategory:", transferCategory);

      request.error(
        400,
        "Transfer Category must be J, F, P, or N " + "for Transfer requests.",
      );

      return false;
    }

    /*
     * For a normal transfer, budgetType_code must
     * still be either P or N.
     */
    if (
      ["P", "N"].includes(transferCategory) &&
      !["P", "N"].includes(budgetType)
    ) {
      LOG.error("budgetType_code is invalid for normal Transfer:", budgetType);

      request.error(
        400,
        "Budget Type must be P or N " + "for normal Transfer requests.",
      );

      return false;
    }
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * Optional entity-field helper
 * ------------------------------------------------------------------ */

/**
 * Returns true when the target entity contains the specified field.
 *
 * This allows the handler to populate workflow tracking fields only
 * when those fields exist in the CDS model.
 *
 * @param {cds.Request} request
 * @param {string} fieldName
 * @returns {boolean}
 */
function targetHasElement(request, fieldName) {
  return Boolean(request.target?.elements?.[fieldName]);
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @Before(
 *   event = { "CREATE" },
 *   entity = "ZSVC_PPS_VIREMENT.Requests"
 * )
 *
 * Prepares the request before it is created:
 *
 * - Determines and persists transferCategory
 * - Validates that at least one RequestItem exists
 * - Validates WBS is filled on all items when Request Type is
 *   Supplement (S) and Budget Type is Project (P)
 * - Validates Material and GL Account alignment on all items
 *   (all request types)
 * - Sets status to Pending Approval
 * - Initializes workflow tracking fields
 * - Sets submission date and period
 * - Calculates all amount fields
 * - Generates the request number
 * - Generates the UI request link
 *
 * This handler does not:
 *
 * - Call the SAP Build Process Automation Decision API
 * - Determine the approver(s)
 * - Start the SAP Build Process Automation workflow
 *
 * The workflow must be started after the database transaction succeeds.
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE Requests started ---");

  try {
    request.data = request.data || {};

    LOG.info("Event:", request.event);

    LOG.info("Target:", request.target?.name);

    LOG.info("Incoming request.data:", JSON.stringify(request.data));

    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);

    const { Requests, RequestItems, RequestHistory } =
      cds.entities(SERVICE_NAMESPACE);

    if (!Requests) {
      LOG.error("Requests entity not found.");

      request.error(
        500,
        "Internal configuration error: " + "Requests entity not found.",
      );

      return;
    }

    /*
     * Read the values required for request preparation.
     */
    const requestId = request.data.ID;

    const requestTypeCode = request.data.requestType_code;

    const budgetTypeCode = request.data.budgetType_code;

    const fiscalYear = request.data.fiscalYear;

    const normalizedRequestType = String(requestTypeCode || "")
      .trim()
      .toUpperCase();

    /*
     * Determine role flags for transfer classification.
     */
    const roleFlags = getUserRoleFlags(request.user);

    /*
     * Determine the persisted transfer classification.
     *
     * For request types R and S, this returns null.
     */
    const transferCategory = determineTransferCategory(
      request,
      requestTypeCode,
      budgetTypeCode,
      roleFlags,
    );

    /*
     * For Transfer requests, a valid category is required.
     */
    if (normalizedRequestType === "T" && !transferCategory) {
      LOG.error("Transfer category could not be determined.");

      return;
    }

    request.data.transferCategory = transferCategory;

    /*
     * Return Category only applies to Return requests. Normalize it here so
     * a stale draft value cannot survive a change of request type.
     */
    const returnCategory =
      normalizedRequestType === "R"
        ? String(request.data.returnCategory_code || "")
            .trim()
            .toUpperCase() || null
        : null;

    request.data.returnCategory_code = returnCategory;

    LOG.info("requestId:", requestId);

    LOG.info("requestType_code:", requestTypeCode);

    LOG.info("budgetType_code:", budgetTypeCode);

    LOG.info("fiscalYear:", fiscalYear);

    LOG.info("Role flags:", JSON.stringify(roleFlags));

    LOG.info("transferCategory:", request.data.transferCategory);

    LOG.info("returnCategory_code:", request.data.returnCategory_code);

    /*
     * Validate the request before performing calculations.
     */
    const isValid = validateSubmission(request, {
      requestId,
      requestTypeCode,
      budgetTypeCode,
      fiscalYear,
      transferCategory,
      returnCategory,
    });

    if (!isValid) {
      LOG.error("Request failed submission validation.");

      return;
    }

    /*
     * Fetch the RequestItems once and reuse them for the
     * "at least one item" check and the item-level business
     * rule validations below.
     */
    const requestItems = await fetchRequestItems({
      tx,
      RequestItems,
      request,
      requestId,
    });

    if (!requestItems.length) {
      LOG.error(
        "Request cannot be submitted without at least one request item.",
      );

      request.error(
        400,
        "At least one Request Item is required before submitting the request.",
      );

      return;
    }

    /*
     * Validate WBS is filled on all items when Request Type is
     * Supplement (S) and Budget Type is Project (P).
     */
    const isWbsValid = validateWbsForProjectBudget(request, {
      items: requestItems,
      requestTypeCode,
      budgetTypeCode,
    });

    if (!isWbsValid) {
      LOG.error(
        "Request failed WBS validation for Supplement / " +
          "Project budget type.",
      );

      return;
    }

    /*
     * Validate Material and GL Account alignment on all items.
     * Applies to all request types.
     */
    const isMaterialGlValid = validateMaterialGlAlignment(request, {
      items: requestItems,
    });

    if (!isMaterialGlValid) {
      LOG.error("Request failed Material / GL Account alignment validation.");

      return;
    }

    /*
     * Validate that every Cost Centre exists in S/4. Applies to all
     * request types.
     */
    const isCostCentreValid = await validateCostCentresExist(request, {
      items: requestItems,
    });

    if (!isCostCentreValid) {
      LOG.error("Request failed Cost Centre validation.");

      return;
    }

    /*
     * Validate that no item has both Transfer In and Transfer Out
     * Amounts filled. Applies to Virement (T) requests only.
     */
    const isTransferExclusivityValid = validateVirementTransferInOutExclusivity(
      request,
      { items: requestItems, requestTypeCode },
    );

    if (!isTransferExclusivityValid) {
      LOG.error(
        "Request failed Transfer In / Out mutual exclusivity validation.",
      );

      return;
    }

    /*
     * Validate the number of Transfer In (1-5) and Transfer Out
     * (exactly 1) line items. Applies to Virement (T) requests only.
     */
    const isVirementItemCountValid = validateVirementItemCounts(request, {
      items: requestItems,
      requestTypeCode,
    });

    if (!isVirementItemCountValid) {
      LOG.error("Request failed Virement line item count validation.");

      return;
    }

    /*
     * Validate that total Transfer Out Amount equals total Transfer
     * In Amount. Applies to Virement (T) requests only.
     */
    const isVirementBalanceValid = validateVirementAmountsBalance(request, {
      items: requestItems,
      requestTypeCode,
    });

    if (!isVirementBalanceValid) {
      LOG.error("Request failed Virement Transfer In / Out balance validation.");

      return;
    }

    /*
     * 1. Set request status to Pending Approval.
     */
    request.data.status_code = REQUEST_STATUS.PENDING_APPROVAL;

    LOG.info("Set status_code to Pending Approval:", request.data.status_code);

    /*
     * 2. Initialize optional workflow tracking fields.
     *
     * These fields are only assigned when they exist in the
     * Requests CDS entity.
     */
    if (targetHasElement(request, "workflowStatus")) {
      request.data.workflowStatus = "NOT_STARTED";
    }

    if (targetHasElement(request, "workflowInstanceId")) {
      request.data.workflowInstanceId = null;
    }

    if (targetHasElement(request, "workflowError")) {
      request.data.workflowError = null;
    }

    if (targetHasElement(request, "currentApprovalLevel")) {
      request.data.currentApprovalLevel = null;
    }

    /*
     * 3. Set submission date and period.
     */
    const dateParts = getLocalDateParts(new Date());

    request.data.submissionDate = dateParts.dateString;

    request.data.submissionPeriod = Number(dateParts.period);

    LOG.info("Set submissionDate:", request.data.submissionDate);

    LOG.info("Set submissionPeriod:", request.data.submissionPeriod);

    /*
     * 4. Calculate all amount fields.
     */
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

    /*
     * 5. Validate that the Project budget type amount cap is not
     * exceeded (Virement: Transfer Out Amount; Supplement: Supplement
     * Amount). Must run after amounts are calculated above.
     */
    const isMaxAmountValid = validateMaxAmountForProjectBudget(request, {
      requestTypeCode,
      budgetTypeCode,
      amounts,
    });

    if (!isMaxAmountValid) {
      LOG.error("Request failed Project budget type maximum amount validation.");

      return;
    }

    /*
     * 6. Generate the request number when it is not
     * already provided.
     */
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
        LOG.error("Request number could not be generated.");

        return;
      }

      request.data.requestNumber = generatedRequestNumber;

      LOG.info("Generated requestNumber:", generatedRequestNumber);
    } else {
      LOG.info(
        "requestNumber already exists. " + "Skipping generation:",
        request.data.requestNumber,
      );
    }

    /*
     * 7. Generate the full UI deep link.
     *
     * The link is saved with the request. The workflow retrieves
     * it from the CAP service by using the request ID.
     */
    request.data.requestLink = generateRequestLink(request, requestId);

    LOG.info("Generated requestLink:", request.data.requestLink);

    /*
     * 8. Reserve funds in S/4 for Virement requests that move budget out.
     *
     * Only a transfer-out commits funds, so a Virement whose transfer-out
     * total is zero reserves nothing and skips the call entirely. The
     * amount is read from request.data, which step 4 above has already
     * recalculated from the line items.
     *
     * The Earmarked Funds document must exist before the request is
     * persisted, so that a rejection from S/4 aborts the submission and
     * the user sees the SAP message instead of a half-submitted request.
     * Because this runs Before CREATE, the approval workflow (started in
     * requests-after-create-logic.js) only ever runs once the document
     * has been created successfully.
     */
    if (
      normalizedRequestType === REQUEST_TYPE_TRANSFER &&
      Number(request.data.transferOutAmount) > 0
    ) {
      LOG.info(
        "Virement request with a transfer-out amount detected. " +
          "Creating Earmarked Funds document before submit.",
      );

      const earmarkedFundsItems = await fetchRequestItems({
        tx,
        RequestItems,
        request,
        requestId,
      });

      const { documentNumber } = await createEarmarkedFundsDocument({
        requestNumber: request.data.requestNumber,
        items: earmarkedFundsItems,
        documentDate: request.data.submissionDate,
      });

      request.data.earmarkedFundsDocNumber = documentNumber;

      LOG.info("Earmarked Funds document number:", documentNumber);
    }

    /*
     * Do not start the workflow here.
     *
     * The Before CREATE handler runs before the database operation
     * is completed. Starting the workflow here could allow the
     * workflow to execute before the request is committed and
     * available through the CAP service.
     */

    LOG.info("Final request.data:", JSON.stringify(request.data));

    LOG.info("--- BEFORE CREATE Requests ended successfully ---");
  } catch (error) {
    const statusCode = error.statusCode || error.status || 500;

    const isExpectedError = Boolean(error.statusCode || error.status);

    LOG.error(
      "Error during request preparation.",
      JSON.stringify({
        statusCode,
        message: error.message,
        responseStatus: error.response?.status,
        responseData: error.response?.data,
        stack: error.stack,
      }),
    );

    request.error(
      statusCode,
      isExpectedError
        ? error.message
        : "An unexpected error occurred " + "while preparing the request.",
    );
  }
};
