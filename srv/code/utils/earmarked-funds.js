const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("earmarked-funds");

/*
 * The Earmarked Funds API is exposed through the same SAP Integration Suite
 * tenant as the FMBB posting (see post-to-s4-logic.js), so it reuses the
 * existing 'CPI' destination and its OAuth2 client-credentials flow. Only
 * the path differs.
 */
const DESTINATION_NAME = "CPI";

const EARMARKED_FUNDS_PATH = "/http/earmarkedfunds/EarmarkedFundsDocument";

/*
 * The standard SAP OData V4 API (API_EARMARKEDFUNDSDOCUMENT / A2X),
 * used only for the completion PATCH - the CPI iFlow above
 * (EARMARKED_FUNDS_PATH) only exposes GET and POST, per the
 * integration guide. This is a NATIVE S/4 OData V4 service path, not
 * a CPI iFlow path, so - like the Cost Centre/GL Account/Material
 * Group/WBS value helps (see utils/value-help.js) - it goes through
 * the S4_DESTINATION_NAME on-premise destination (Cloud Connector),
 * not the CPI one: routing this through 'CPI' failed with "Failed to
 * get CSRF token", since that destination only proxies its own
 * iFlow's paths.
 */
const S4_DESTINATION_NAME = "QA1-800-S4HANA";

/*
 * Confirmed against the service's own OpenAPI spec
 * (sap-s4-OP_API_EARMARKEDFUNDS_SRV_0001-v1.json, servers[0].url) -
 * the same srvd_a2x OData V4 service used for the completion PATCH
 * below.
 */
const EARMARKED_FUNDS_S4_BASE_PATH =
  "/sap/opu/odata4/sap/api_earmarkedfundsdocument/srvd_a2x/sap/earmarkedfundsdocument/0001";

const EARMARKED_FUNDS_UPDATE_PATH = `${EARMARKED_FUNDS_S4_BASE_PATH}/EarmarkedFundsDocument`;

const SAP_CLIENT = "800";

/*
 * DEV values for the JV Portal scenario, per the integration guide
 * (section 3). Confirm with FM functional before UAT.
 */
const DOCUMENT_CATEGORY = "30";
const DOCUMENT_TYPE = "11";
const COMPANY_CODE = "1000";
const CURRENCY = "MYR";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Formats a Date (or ISO-ish string) as the YYYY-MM-DD the API expects.
 *
 * @param {Date|string} value
 * @returns {string}
 */
function toApiDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

/**
 * Builds one Earmarked Funds item from a Request Item.
 *
 * The reserved amount is the line's transfer-out amount: only the outgoing
 * side of a Virement commits budget.
 *
 * Field order matters: the integration layer converts the JSON to a
 * schema-validated format in which element order is significant, so the
 * properties below are emitted in exactly the order given by the guide.
 *
 * Account assignment follows the same mapping the FMBB posting uses
 * (post-to-s4-logic.js): FundsCenter from costCentre, CommitmentItem
 * from glAccount.
 *
 * @param {object} item - a Request Item row
 * @param {number} index - zero-based position, used for fallback text
 * @returns {object}
 */
function buildItem(item, index) {
  return {
    CommitmentItem: String(item.glAccount ?? "").trim(),
    DocumentItemText: String(item.description ?? "").trim() || `Line ${index + 1}`,
    EmrkdFndsAmountInTransCrcy: Number(item.transferOutAmount) || 0,
    FundsCenter: String(item.costCentre ?? "").trim(),
    TransactionCurrency: CURRENCY,
  };
}

/**
 * Builds the deep-insert payload. Header field order is likewise fixed.
 *
 * @param {object} params
 * @param {string} params.requestNumber
 * @param {object[]} params.items
 * @param {Date|string} [params.documentDate]
 * @returns {object}
 */
function buildPayload({ requestNumber, items, documentDate }) {
  const date = toApiDate(documentDate || new Date());

  return {
    EarmarkedFundsDocumentCategory: DOCUMENT_CATEGORY,
    EarmarkedFundsDocumentType: DOCUMENT_TYPE,
    CompanyCode: COMPANY_CODE,
    DocumentDate: date,
    PostingDate: date,
    TransactionCurrency: CURRENCY,
    EarmarkedFundsHeaderText: `Virement ${requestNumber || ""}`.trim(),
    _EarmarkedFundsDocumentItem: {
      EarmarkedFundsDocumentItem_Type: items.map(buildItem),
    },
  };
}

/**
 * Extracts the generated document number from the POST response.
 *
 * The integration layer wraps the document in EarmarkedFundsDocument_Type
 * and returns numbers/booleans as strings, so read defensively.
 *
 * @param {*} data - the response body
 * @returns {string} the document number, or "" when absent
 */
function extractDocumentNumber(data) {
  const doc = data?.EarmarkedFundsDocument_Type || data || {};

  return String(doc.EarmarkedFundsDocument ?? "").trim();
}

/**
 * Strips technical noise the integration layer sometimes appends to
 * an S/4 error detail: a stray "null" (an unset field concatenated in
 * upstream) followed by the raw HTTP status line in brackets, e.g.
 * "...document item 00001null [HTTP/1.1 400 Bad Request]". Neither
 * tells the user anything the SAP message code and text before it
 * hasn't already said, so both are trimmed off the end.
 *
 * @param {string} detail
 * @returns {string}
 */
function cleanErrorDetail(detail) {
  return String(detail ?? "")
    .replace(/\s*\[HTTP\/\d+(?:\.\d+)?\s+\d{3}[^\]]*\]\s*$/i, "")
    .replace(/\s*null\s*$/i, "")
    .trim();
}

/**
 * Pulls the human-readable SAP message out of an error response.
 *
 * The integration layer wraps S/4 rejections as
 * 502 { error, detail } where detail carries the SAP text,
 * e.g. "(FMEF/007) Enter a document category".
 *
 * @param {*} error
 * @returns {string}
 */
function extractErrorDetail(error) {
  const body = error?.response?.data;

  if (typeof body === "string" && body.trim()) {
    return cleanErrorDetail(body);
  }

  /*
   * body.error can be a plain string (the CPI iFlow wrapper's own
   * shape), an OData V2 error ({message: {value: "..."}}), or an
   * OData V4 error ({message: "...", code, target, ...} - the native
   * S/4 API used for the completion PATCH). Checked in that order;
   * if none match, the raw object is JSON-stringified rather than
   * left to coerce to the useless literal "[object Object]".
   */
  const errorField = body?.error;

  const detail =
    body?.detail ||
    (typeof errorField === "string" ? errorField : null) ||
    errorField?.message?.value ||
    (typeof errorField?.message === "string" ? errorField.message : null) ||
    (errorField && typeof errorField === "object"
      ? JSON.stringify(errorField)
      : null) ||
    error?.message ||
    "Unknown Earmarked Funds error.";

  return cleanErrorDetail(detail);
}

/**
 * Keeps only the items that actually reserve funds.
 *
 * Funds are reserved against the transfer-out amount, since that is the
 * side of a Virement that commits budget. A zero-amount line commits
 * nothing, and S/4 rejects zero-value items on a funds reservation, which
 * would fail an otherwise valid request. Such lines are therefore left out
 * of the document rather than sent through. On a Virement this also drops
 * the pure transfer-in lines, which carry no transfer-out amount.
 *
 * @param {object[]} items
 * @returns {object[]}
 */
function withReservableAmount(items) {
  return items.filter(function (item) {
    return (Number(item.transferOutAmount) || 0) > 0;
  });
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Creates an Earmarked Funds document in S/4 for the given request items.
 *
 * @param {object} params
 * @param {string} params.requestNumber - used as the header text
 * @param {object[]} params.items - Request Items to reserve funds for
 * @param {Date|string} [params.documentDate]
 * @returns {Promise<{documentNumber: string, raw: *}>}
 * @throws {Error} with .statusCode and a message safe to show the user
 */
async function createEarmarkedFundsDocument({
  requestNumber,
  items,
  documentDate,
}) {
  if (!Array.isArray(items) || items.length === 0) {
    const error = new Error(
      "The request has no line items, so no Earmarked Funds document " +
        "can be created.",
    );

    error.statusCode = 400;

    throw error;
  }

  const reservableItems = withReservableAmount(items);

  if (reservableItems.length === 0) {
    const error = new Error(
      "Every line item has a zero amount, so no funds can be reserved. " +
        "Enter an amount on at least one line before submitting.",
    );

    error.statusCode = 400;

    throw error;
  }

  if (reservableItems.length < items.length) {
    LOG.info(
      "Skipping zero-amount line items for the Earmarked Funds document.",
      JSON.stringify({
        total: items.length,
        reserved: reservableItems.length,
      }),
    );
  }

  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${DESTINATION_NAME}' was not found. The Earmarked ` +
        "Funds document could not be created.",
    );

    error.statusCode = 500;

    throw error;
  }

  const configuredUrl =
    destination.originalProperties?.destinationConfiguration?.URL ||
    destination.url;

  const baseUrl = String(configuredUrl || "").replace(/\/$/, "");

  const url = `${baseUrl}${EARMARKED_FUNDS_PATH}?sap-client=${SAP_CLIENT}`;

  const payload = buildPayload({
    requestNumber,
    items: reservableItems,
    documentDate,
  });

  LOG.info(
    "Creating Earmarked Funds document.",
    JSON.stringify({ requestNumber, itemCount: items.length, url }),
  );

  let response;

  try {
    response = await executeHttpRequest(destination, {
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      data: payload,
    });
  } catch (error) {
    const detail = extractErrorDetail(error);

    LOG.error(
      "Earmarked Funds creation failed.",
      JSON.stringify({
        requestNumber,
        httpStatus: error?.response?.status,
        detail,
      }),
    );

    const wrapped = new Error(
      `Earmarked Funds document could not be created: ${detail}`,
    );

    wrapped.statusCode = 400;
    wrapped.detail = detail;

    throw wrapped;
  }

  const documentNumber = extractDocumentNumber(response?.data);

  if (!documentNumber) {
    LOG.error(
      "Earmarked Funds response contained no document number.",
      JSON.stringify({ requestNumber, body: response?.data }),
    );

    const error = new Error(
      "Earmarked Funds document could not be created: the response " +
        "contained no document number.",
    );

    error.statusCode = 502;

    throw error;
  }

  LOG.info(
    "Earmarked Funds document created.",
    JSON.stringify({ requestNumber, documentNumber }),
  );

  return { documentNumber, raw: response?.data };
}

/**
 * Fetches a CSRF token + session cookie for a subsequent PATCH,
 * against the given (GET-able) url on the given destination.
 *
 * Done manually rather than via the SAP Cloud SDK's built-in
 * automatic CSRF pre-flight (executeHttpRequest's default
 * fetchCsrfToken: true): that pre-flight always appends a trailing
 * slash to the request's own URL first (a workaround for a different,
 * older S/4 redirect issue - see the SDK's own csrf-token-middleware
 * source), which THIS service instead rejects outright as "URI has a
 * slash as last character" (IWCOR/CX_OD_URI_SYNTAX_ERROR) on an
 * entity-key path like ours - confirmed live via the SAP Gateway
 * payload trace and error log. Fetching the token ourselves against
 * the url as-is (no appended slash) avoids that, while this service
 * does genuinely enforce CSRF (confirmed live: disabling the fetch
 * entirely gets "CSRF token is missing" on the PATCH), so it can't
 * just be skipped either.
 *
 * @param {object} destination
 * @param {string} url
 * @returns {Promise<object>} headers to spread onto the PATCH call -
 *   empty if no token could be obtained, in which case the PATCH will
 *   fail with S/4's own "CSRF token is missing" instead
 */
async function fetchCsrfHeaders(destination, url) {
  try {
    const response = await executeHttpRequest(
      destination,
      {
        method: "GET",
        url,
        headers: { Accept: "application/json", "x-csrf-token": "Fetch" },
      },
      { fetchCsrfToken: false },
    );

    const token = response?.headers?.["x-csrf-token"];

    if (!token) {
      return {};
    }

    const setCookie = response?.headers?.["set-cookie"];

    const cookie = Array.isArray(setCookie)
      ? setCookie.map((entry) => String(entry).split(";")[0]).join("; ")
      : setCookie
        ? String(setCookie).split(";")[0]
        : "";

    return { "x-csrf-token": token, ...(cookie ? { Cookie: cookie } : {}) };
  } catch (error) {
    LOG.error(
      "Failed to fetch a CSRF token ahead of an Earmarked Funds item PATCH.",
      JSON.stringify({ url, detail: extractErrorDetail(error) }),
    );

    return {};
  }
}

/**
 * Marks an existing Earmarked Funds document as completed, once the
 * Virement it reserved funds for has actually been posted to S/4
 * (see post-to-s4-logic.js: called after the combined Transfer
 * out+in document number is set).
 *
 * Uses the standard S/4 OData V4 API directly (PATCH), not the CPI
 * iFlow used for create/read - that iFlow only exposes GET and POST
 * per the integration guide. A blind update (If-Match: *) is used
 * since this app has no prior GET/ETag for the document at this
 * point.
 *
 * @param {object} params
 * @param {string} params.documentNumber - the Earmarked Funds
 *   document number to complete (Requests.earmarkedFundsDocNumber)
 * @returns {Promise<void>}
 * @throws {Error} with .statusCode and a message safe to show the user
 */
async function completeEarmarkedFundsDocument({ documentNumber }) {
  if (!documentNumber) {
    const error = new Error(
      "An Earmarked Funds document number is required to mark it complete.",
    );

    error.statusCode = 400;

    throw error;
  }

  const destination = await getDestination({
    destinationName: S4_DESTINATION_NAME,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${S4_DESTINATION_NAME}' was not found. The Earmarked ` +
        "Funds document could not be marked complete.",
    );

    error.statusCode = 500;

    throw error;
  }

  const configuredUrl =
    destination.originalProperties?.destinationConfiguration?.URL ||
    destination.url;

  const baseUrl = String(configuredUrl || "").replace(/\/$/, "");

  const escapedKey = String(documentNumber).replace(/'/g, "''");

  /*
   * No ?sap-client here, unlike the CPI-routed calls above - this
   * on-premise destination already carries the client (QA1-800-...),
   * same as every value-help call through it (see utils/value-help.js
   * and utils/cost-centers.js: neither appends sap-client either).
   */
  const documentUrl = `${baseUrl}${EARMARKED_FUNDS_UPDATE_PATH}('${escapedKey}')`;

  /*
   * EarmarkedFundsIsCompleted on the header is a computed/read-only
   * status - confirmed live: a PATCH against it returns 200 with no
   * SAP__Messages, but silently leaves the value unchanged. The
   * actual writable completion flag is per LINE ITEM
   * (EmrkdFndsItmIsCompleted on _EarmarkedFundsDocumentItem), so
   * every item has to be fetched and completed individually.
   */
  let items;

  try {
    const itemsResponse = await executeHttpRequest(destination, {
      method: "GET",
      url: `${documentUrl}/_EarmarkedFundsDocumentItem`,
      headers: { Accept: "application/json" },
    });

    items = itemsResponse?.data?.value || [];
  } catch (error) {
    const detail = extractErrorDetail(error);

    LOG.error(
      "Failed to read Earmarked Funds document items before " +
        "completing them.",
      JSON.stringify({ documentNumber, httpStatus: error?.response?.status, detail }),
    );

    const wrapped = new Error(
      `Earmarked Funds document ${documentNumber} items could not be ` +
        `read: ${detail}`,
    );

    wrapped.statusCode = 502;
    wrapped.detail = detail;

    throw wrapped;
  }

  if (!items.length) {
    const error = new Error(
      `Earmarked Funds document ${documentNumber} has no line items to complete.`,
    );

    error.statusCode = 502;

    throw error;
  }

  const failures = [];

  for (const item of items) {
    const itemNumber = item.EarmarkedFundsDocumentItem;

    /*
     * The documented top-level entity set with its full composite
     * key (see the OpenAPI spec's
     * /EarmarkedFundsDocumentItem/{EarmarkedFundsDocument}/{EarmarkedFundsDocumentItem}
     * path), rather than the nested navigation-property form used
     * for the GET above - this is the exact shape PATCH is
     * documented against.
     */
    const escapedItemNumber = String(itemNumber).replace(/'/g, "''");

    const itemUrl =
      `${baseUrl}${EARMARKED_FUNDS_S4_BASE_PATH}/EarmarkedFundsDocumentItem` +
      `(EarmarkedFundsDocument='${escapedKey}',EarmarkedFundsDocumentItem='${escapedItemNumber}')`;

    try {
      let response;

      // See fetchCsrfHeaders' own doc comment for why this is fetched
      // manually rather than left to executeHttpRequest's default
      // automatic pre-flight.
      const csrfHeaders = await fetchCsrfHeaders(destination, itemUrl);

      try {
        /*
         * Tried first, completion-flag only. Once this item's amount
         * has actually been drawn down by a downstream posting (as
         * here - this runs after the Transfer document referencing it
         * already posted, see approve-reject-request.js), S/4 locks
         * its account assignment: merely naming FundsCenter /
         * CommitmentItem / CompanyCode / TransactionCurrency in the
         * PATCH body - even resending their current, unchanged values -
         * is treated as an attempted change and rejected with
         * "Read-only fields must not be changed".
         */
        response = await executeHttpRequest(
          destination,
          {
            method: "PATCH",
            url: itemUrl,
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "If-Match": "*",
              ...csrfHeaders,
            },
            data: {
              EarmarkedFundsDocument: documentNumber,
              EmrkdFndsItmIsCompleted: true,
              EmrkdFndsItmIsApproved: true,
            },
          },
          { fetchCsrfToken: false },
        );
      } catch (minimalError) {
        const minimalDetail = extractErrorDetail(minimalError);

        if (!/funds center/i.test(minimalDetail)) {
          throw minimalError;
        }

        /*
         * Before the item has been consumed by anything downstream, S/4
         * instead rejects a completion-only PATCH with "No funds
         * center entered/derived in item 00001 (1000//)" - it
         * re-checks account assignment on this PATCH as if the fields
         * not included in the body were blanked out, rather than left
         * untouched. Resending the assignment this item was actually
         * created with (from the GET above) alongside the completion
         * flag avoids that case.
         */
        response = await executeHttpRequest(
          destination,
          {
            method: "PATCH",
            url: itemUrl,
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "If-Match": "*",
              ...csrfHeaders,
            },
            data: {
              EarmarkedFundsDocument: documentNumber,
              CompanyCode: item.CompanyCode,
              TransactionCurrency: item.TransactionCurrency,
              FundsCenter: item.FundsCenter,
              CommitmentItem: item.CommitmentItem,
              EmrkdFndsItmIsCompleted: true,
              EmrkdFndsItmIsApproved: true,
            },
          },
          { fetchCsrfToken: false },
        );
      }

      LOG.info(
        "Earmarked Funds item completion PATCH response.",
        JSON.stringify({
          documentNumber,
          itemNumber,
          httpStatus: response?.status,
          isCompleted: response?.data?.EmrkdFndsItmIsCompleted,
        }),
      );
    } catch (error) {
      const detail = extractErrorDetail(error);

      LOG.error(
        "Failed to mark an Earmarked Funds item complete.",
        JSON.stringify({
          documentNumber,
          itemNumber,
          httpStatus: error?.response?.status,
          detail,
        }),
      );

      failures.push({ itemNumber, detail });
    }
  }

  if (failures.length) {
    const detail = failures
      .map(({ itemNumber, detail: itemDetail }) => `item ${itemNumber}: ${itemDetail}`)
      .join("; ");

    const wrapped = new Error(
      `Earmarked Funds document ${documentNumber} could not be fully ` +
        `marked complete: ${detail}`,
    );

    wrapped.statusCode = 502;
    wrapped.detail = detail;

    throw wrapped;
  }

  /*
   * All line items are completed - now complete the header itself.
   * EarmarkedFundsIsCompleted is listed as writable in the official
   * API's own -update schema, so this is attempted directly (same
   * manual CSRF handling as the item PATCHes above, and same blind
   * If-Match: * - no prior GET/ETag for the header at this point
   * either).
   *
   * Deliberately minimal - EarmarkedFundsDocument (the header's own
   * key) plus the completion/approval flags only. A version of this
   * that echoed back every field the header's -update schema lists
   * (EarmarkedFundsDocumentCategory, CompanyCode, TransactionCurrency,
   * etc.) was tried and made things worse: S/4 rejected it outright
   * with "Read-only fields must not be changed", confirming those
   * identity fields are genuinely immutable once the document exists.
   * This minimal body avoids that - S/4 accepts it (200), but
   * confirmed live to silently leave EarmarkedFundsIsCompleted
   * unchanged regardless: a real business-logic override, not a
   * payload-shape problem this client can work around.
   */
  const headerPatchBody = {
    EarmarkedFundsDocument: documentNumber,
    EarmarkedFundsIsCompleted: true,
    EarmarkedFundsIsApproved: true,
    EmrkdFndsWasAlreadyAprvdOnce: true,
  };

  const headerCsrfHeaders = await fetchCsrfHeaders(destination, documentUrl);

  try {
    const headerResponse = await executeHttpRequest(
      destination,
      {
        method: "PATCH",
        url: documentUrl,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "If-Match": "*",
          ...headerCsrfHeaders,
        },
        data: headerPatchBody,
      },
      { fetchCsrfToken: false },
    );

    LOG.info(
      "Earmarked Funds header completion PATCH response.",
      JSON.stringify({
        documentNumber,
        httpStatus: headerResponse?.status,
        isCompleted: headerResponse?.data?.EarmarkedFundsIsCompleted,
      }),
    );
  } catch (error) {
    const detail = extractErrorDetail(error);

    LOG.error(
      "Earmarked Funds line items were completed, but the header " +
        "could not be marked complete.",
      JSON.stringify({
        documentNumber,
        httpStatus: error?.response?.status,
        detail,
      }),
    );

    const wrapped = new Error(
      `Earmarked Funds document ${documentNumber}'s line items were ` +
        `marked complete, but the header could not be: ${detail}`,
    );

    wrapped.statusCode = 502;
    wrapped.detail = detail;

    throw wrapped;
  }

  LOG.info(
    "Earmarked Funds document marked complete (all items + header).",
    JSON.stringify({ documentNumber, itemCount: items.length }),
  );
}

/**
 * Reads an Earmarked Funds document's current completion status
 * directly from S/4, for the Object Page's live status check (see
 * requests-after-read-logic.js) - the persisted
 * Requests.earmarkedFundsDocNumber never itself records whether the
 * document has been completed, so this is checked live on demand
 * rather than cached.
 *
 * Uses the CPI iFlow's documented single-document read (section 2.2
 * of the integration guide) - a plain OData V4 passthrough, unlike
 * the wrapped/stringified shape POST responses have.
 *
 * Never throws: a failed check should not break the Object Page, so
 * errors are logged and reported back as { isCompleted: false, error: true }.
 *
 * @param {object} params
 * @param {string} params.documentNumber
 * @returns {Promise<{isCompleted: boolean, error?: boolean}>}
 */
async function getEarmarkedFundsDocumentStatus({ documentNumber }) {
  if (!documentNumber) {
    return { isCompleted: false };
  }

  try {
    const destination = await getDestination({
      destinationName: DESTINATION_NAME,
    });

    if (!destination) {
      throw new Error(`Destination '${DESTINATION_NAME}' was not found.`);
    }

    const configuredUrl =
      destination.originalProperties?.destinationConfiguration?.URL ||
      destination.url;

    const baseUrl = String(configuredUrl || "").replace(/\/$/, "");

    const url =
      `${baseUrl}${EARMARKED_FUNDS_PATH}/${encodeURIComponent(documentNumber)}` +
      `?sap-client=${SAP_CLIENT}`;

    const response = await executeHttpRequest(destination, {
      method: "GET",
      url,
      headers: { Accept: "application/json" },
    });

    const isCompleted =
      response?.data?.EarmarkedFundsIsCompleted === true ||
      String(response?.data?.EarmarkedFundsIsCompleted).toLowerCase() ===
        "true";

    LOG.info(
      "Earmarked Funds document status read.",
      JSON.stringify({
        documentNumber,
        earmarkedFundsIsCompleted: response?.data?.EarmarkedFundsIsCompleted,
        resolvedIsCompleted: isCompleted,
      }),
    );

    return { isCompleted };
  } catch (error) {
    LOG.error(
      "Failed to read Earmarked Funds document status.",
      JSON.stringify({
        documentNumber,
        httpStatus: error?.response?.status,
        detail: extractErrorDetail(error),
      }),
    );

    return { isCompleted: false, error: true };
  }
}

module.exports = {
  createEarmarkedFundsDocument,
  completeEarmarkedFundsDocument,
  getEarmarkedFundsDocumentStatus,
  withReservableAmount,
  buildPayload,
  extractDocumentNumber,
  extractErrorDetail,
};
