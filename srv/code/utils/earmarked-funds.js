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

const SAP_CLIENT = "230";

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
    EmrkdFndsAmountInTransCrcy: Number(item.supplementAmount) || 0,
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
    return body.trim();
  }

  return (
    body?.detail ||
    body?.error?.message?.value ||
    body?.error ||
    error?.message ||
    "Unknown Earmarked Funds error."
  );
}

/**
 * Keeps only the items that actually reserve funds.
 *
 * A zero-amount line commits nothing, and S/4 rejects zero-value items on
 * a funds reservation, which would fail an otherwise valid request. Such
 * lines are therefore left out of the document rather than sent through.
 *
 * @param {object[]} items
 * @returns {object[]}
 */
function withReservableAmount(items) {
  return items.filter(function (item) {
    return (Number(item.supplementAmount) || 0) > 0;
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

module.exports = {
  createEarmarkedFundsDocument,
  withReservableAmount,
  buildPayload,
  extractDocumentNumber,
  extractErrorDetail,
};
