const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const xml2js = require("xml2js");

const LOG = cds.log("earmarked-funds");

/*
 * The Earmarked Funds API is exposed through the same SAP Integration Suite
 * tenant as the FMBB posting (see post-to-s4-logic.js), so it reuses the
 * existing 'CPI' destination and its OAuth2 client-credentials flow. Only
 * the path differs.
 */
const DESTINATION_NAME = "CPI";

const EARMARKED_FUNDS_PATH = "/http/earmarkedfunds/EarmarkedFundsDocument";
const COMPLETE_RFC_ENDPOINT = "/http/Z_KFM_EF_COMPLETE";


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

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/*
 * S/4 document numbers are CHAR10 with leading zeros (e.g. 0200000048),
 * but Requests.earmarkedFundsDocNumber is stored without them.
 */
function padDocumentNumber(documentNumber) {
  const value = String(documentNumber ?? "").trim();

  return /^\d+$/.test(value) ? value.padStart(10, "0") : value;
}

function buildCompleteXml({ documentNumber, test }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<n0:Z_KFM_EF_COMPLETE xmlns:n0="urn:sap-com:document:sap:rfc:functions">',
    `  <IM_BELNR>${escapeXml(padDocumentNumber(documentNumber))}</IM_BELNR>`,
    `  <IM_TEST>${test ? "X" : ""}</IM_TEST>`,
    "  <T_RETURN></T_RETURN>",
    "</n0:Z_KFM_EF_COMPLETE>",
  ].join("\n");
}

function findXmlValue(object, localName) {
  if (!object || typeof object !== "object") return undefined;

  for (const [key, value] of Object.entries(object)) {
    const name = key.includes(":") ? key.split(":").pop() : key;
    if (name === localName) return value;
  }

  for (const value of Object.values(object)) {
    const found = findXmlValue(value, localName);
    if (found !== undefined) return found;
  }

  return undefined;
}

function firstText(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" ? v.trim() : "";
}

async function parseCompleteResponse(rawResponse) {
  const text = Buffer.isBuffer(rawResponse)
    ? rawResponse.toString("utf8")
    : String(rawResponse ?? "");

  if (!text.trim()) return [];

  const parsed = await xml2js.parseStringPromise(text);
  const returnTable = findXmlValue(parsed, "T_RETURN");
  const items = findXmlValue(returnTable, "item") ?? [];

  return (Array.isArray(items) ? items : [items])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      type: firstText(item.TYPE).toUpperCase(),
      message: firstText(item.MESSAGE),
    }));
}

/**
 * Marks an existing Earmarked Funds document as completed by calling
 * the Z_KFM_EF_COMPLETE RFC through the CPI iFlow (same route as the
 * FMBB posting). The RFC wraps the standard FMFR_CHANGE_COMPLETION_FLAG
 * on the S/4 side.
 *
 * @param {object} params
 * @param {string} params.documentNumber - the Earmarked Funds document
 *   number to complete (Requests.earmarkedFundsDocNumber)
 * @param {boolean} [params.test=false] - check-only run; nothing is
 *   changed in S/4
 * @returns {Promise<void>}
 * @throws {Error} with .statusCode and a message safe to show the user
 */
async function completeEarmarkedFundsDocument({ documentNumber, test = false }) {
  if (!documentNumber) {
    const error = new Error(
      "An Earmarked Funds document number is required to mark it complete.",
    );

    error.statusCode = 400;

    throw error;
  }

  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${DESTINATION_NAME}' was not found. The Earmarked ` +
        "Funds document could not be marked complete.",
    );

    error.statusCode = 500;

    throw error;
  }

  const configuredUrl =
    destination.originalProperties?.destinationConfiguration?.URL ||
    destination.url;

  if (!configuredUrl) {
    const error = new Error(
      `Destination '${DESTINATION_NAME}' has no URL configured.`,
    );

    error.statusCode = 500;

    throw error;
  }

  const baseUrl = String(configuredUrl).replace(/\/$/, "");
  const url = baseUrl.endsWith(COMPLETE_RFC_ENDPOINT)
    ? baseUrl
    : `${baseUrl}${COMPLETE_RFC_ENDPOINT}`;

  let rawResponse;

  try {
    const response = await executeHttpRequest(destination, {
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml",
      },
      data: buildCompleteXml({ documentNumber, test }),
    });

    rawResponse = response?.data;
  } catch (error) {
    LOG.error(
      "Earmarked Funds completion request to CPI failed.",
      JSON.stringify({
        documentNumber,
        httpStatus: error?.response?.status,
        detail: extractErrorDetail(error),
      }),
    );

    const failure = new Error(
      "The Earmarked Funds document could not be marked complete.",
    );

    failure.statusCode = 502;
    failure.detail = extractErrorDetail(error);

    throw failure;
  }

  const messages = await parseCompleteResponse(rawResponse);
  const errors = messages.filter(({ type }) => type === "E" || type === "A");

  if (errors.length) {
    const failure = new Error(
      errors
        .map(({ message }) => message)
        .filter(Boolean)
        .slice(0, 3)
        .join(" ")
        .slice(0, 1000) ||
        "S/4 could not mark the Earmarked Funds document complete.",
    );

    failure.statusCode = 422;

    throw failure;
  }

  LOG.info(
    test
      ? "Earmarked Funds completion check-only run passed."
      : "Earmarked Funds document marked complete.",
    JSON.stringify({ documentNumber, messages }),
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
