// ==================================================================
// File: code/post-to-s4-logic.js
// ==================================================================

"use strict";

const cds = require("@sap/cds");
const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const xml2js = require("xml2js");
const { randomInt } = require("node:crypto");

const insertRequestHistory = require("./insert-request-history");

const LOG = cds.log("post-to-s4-logic");
const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const DESTINATION_NAME = "CPI";
const RFC_ENDPOINT = "/http/ZFM_FI_FMBB_UPLOAD";
const POSTED_STATUS_CODE = 3;

/*
 * Status codes from the shared RequestStatus codelist, reused here
 * for RequestApprovers rows:
 *   2 = PendingApproval
 *   3 = Completed (i.e. this approver Approved)
 */
const APPROVER_PENDING_STATUS_CODE = 2;
const APPROVER_APPROVED_STATUS_CODE = 3;

const S4_TEST_MODE = ""; // "X" = test, "" = actual posting

const PROCESS_TYPES = {
  S: "SUPL",
  R: "RETN",
  T: "TRAN",
};

const BUDGET_TYPES = {
  P: "PROJECT",
  N: "NONPROJ",
};

const AMOUNT_CONFIGS = [
  {
    key: "SUPL",
    process: "SUPL",
    field: "supplementAmount",
    sign: "+",
    direction: "IN",
    documentField: "supplementDocNumber",
  },
  {
    key: "RETN",
    process: "RETN",
    field: "returnAmount",
    sign: "+",
    direction: "OUT",
    documentField: "returnDocNumber",
  },
  {
    key: "TRAN_OUT",
    process: "TRAN",
    field: "transferOutAmount",
    sign: "-",
    direction: "OUT",
    documentField: "transferOutDocNumber",
  },
  {
    key: "TRAN_IN",
    process: "TRAN",
    field: "transferInAmount",
    sign: "+",
    direction: "IN",
    documentField: "transferInDocNumber",
  },
];

const HEADER_FIELDS = [
  "IV_FM_AREA",
  "IV_PROC",
  "IV_VERS",
  "IV_BUDC",
  "IV_DOCT",
  "IV_DATE",
  "IV_FYEAR",
  "IV_SFYEAR",
  "IV_SBUDT",
  "IV_SPERIO",
  "IV_RFYEAR",
  "IV_RBUDT",
  "IV_RPERIO",
  "IV_RESP",
  "IV_HDR_TEXT",
  "IV_SUPL_TYPE",
  "IV_TEST",
];

const ITEM_FIELDS = [
  "SIGN",
  "FUNDCTR",
  "CMMTITM",
  "MATKL",
  "DISTKEY",
  "QUANTITY",
  "PRICE",
  "ZSTAT",
  "ZDESC",
  "REFNO",
];

const xmlParser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

function createBusinessError(statusCode, message, userMessage = message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = userMessage;
  return error;
}

function associationCode(entity, name) {
  return String(
    entity?.[name]?.code ?? entity?.[`${name}_code`] ?? entity?.[name] ?? "",
  ).trim();
}

function getProcess(requestData) {
  const code = associationCode(requestData, "requestType").toUpperCase();
  const process = PROCESS_TYPES[code];

  if (!process) {
    throw createBusinessError(
      400,
      `Unsupported request type code '${code || "blank"}'.`,
      "Only Supplement, Return, and Transfer requests can be posted to S/4.",
    );
  }

  return process;
}

function getSupplyType(requestData) {
  const code = associationCode(requestData, "budgetType").toUpperCase();
  const supplyType = BUDGET_TYPES[code];

  if (!supplyType) {
    throw createBusinessError(
      400,
      `Unsupported SUPL project type code '${code || "blank"}'.`,
      "Please select either Project or Non-Project before posting a Supplement request to S/4.",
    );
  }

  return supplyType;
}

function toSapDate(value) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    throw createBusinessError(
      400,
      `Invalid posting date '${value}'.`,
      "The posting date is invalid.",
    );
  }

  return date.toISOString().slice(0, 10);
}

function toAmount(value) {
  if (value === null || value === undefined || value === "") return 0;
  const amount = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(amount) ? amount : NaN;
}

function generateTestDocumentNumber() {
  return String(randomInt(1000000000, 10000000000));
}

function formatAmount(value) {
  return Number(value)
    .toFixed(2)
    .replace(/\.?0+$/, "");
}

async function fetchRequestWithItems(requestId, tx) {
  const requestData = await tx.run(
    SELECT.one.from(`${SERVICE_NAMESPACE}.Requests`).where({ ID: requestId }),
  );

  if (!requestData) {
    throw createBusinessError(
      404,
      `Request '${requestId}' was not found.`,
      "The selected request could not be found. Please refresh the page and try again.",
    );
  }

  const items = await tx.run(
    SELECT.from(`${SERVICE_NAMESPACE}.RequestItems`)
      .where({ request_ID: requestId })
      .orderBy("srNo"),
  );

  LOG.info("Request retrieved from database", {
    requestId,
    requestNumber: requestData.requestNumber,
    requestType: requestData.requestType_code,
    budgetType: requestData.budgetType_code,
    itemCount: items?.length ?? 0,
  });

  return { requestData, items: items ?? [] };
}

/**
 * Marks the acting approver's RequestApprovers row as Completed
 * (Approved), then resolves every other still-Pending approver at
 * the SAME level for this request, since only one approval is
 * required per level (first-approval-wins). Those other rows are
 * also marked Completed, but with a comment noting they were
 * superseded, and their actionDate is left blank to distinguish
 * them from the approver who actually acted.
 *
 * Inserts RequestHistory entries documenting both the actual
 * approval and, if applicable, the auto-resolution of the other
 * candidates.
 *
 * If emailAddress is not provided, or no matching Pending row is
 * found, this is logged as a warning but does NOT block posting -
 * posting is still allowed to proceed so a request is never stuck
 * unposted purely due to a missing/mismatched approver identity.
 *
 * @param {object} tx
 * @param {cds.Request} request
 * @param {string} requestId
 * @param {string} emailAddress
 * @returns {Promise<void>}
 */
async function markApproverApproved(tx, request, requestId, emailAddress) {
  if (!emailAddress) {
    LOG.warn(
      "postToS4 called without emailAddress. Skipping approver " +
        "row update.",
      requestId,
    );

    return;
  }

  const { RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

  const approverRow = await tx.run(
    SELECT.one
      .from(RequestApprovers)
      .columns("ID", "level", "status_code")
      .where({ request_ID: requestId, emailAddress }),
  );

  if (!approverRow) {
    LOG.warn(
      "No RequestApprovers row found for approver.",
      JSON.stringify({ requestId, emailAddress }),
    );

    return;
  }

  if (approverRow.status_code !== APPROVER_PENDING_STATUS_CODE) {
    LOG.warn(
      "Approver decision already recorded. Skipping duplicate update.",
      JSON.stringify({ requestId, emailAddress }),
    );

    return;
  }

  await tx.run(
    UPDATE(RequestApprovers)
      .set({
        status_code: APPROVER_APPROVED_STATUS_CODE,
        actionDate: new Date().toISOString(),
      })
      .where({ ID: approverRow.ID }),
  );

  LOG.info(
    "Approver marked as Completed:",
    JSON.stringify({ requestId, emailAddress }),
  );

  await insertRequestHistory(
    request,
    requestId,
    `Approved by ${emailAddress}.`,
  );

  /*
   * Resolve every other still-Pending approver at the same level,
   * since only one approval is required per level.
   */
  const siblingRows = await tx.run(
    SELECT.from(RequestApprovers).columns("ID", "emailAddress").where({
      request_ID: requestId,
      level: approverRow.level,
      status_code: APPROVER_PENDING_STATUS_CODE,
    }),
  );

  if (siblingRows.length === 0) {
    return;
  }

  const siblingIds = siblingRows.map((row) => row.ID);

  await tx.run(
    UPDATE(RequestApprovers)
      .set({
        status_code: APPROVER_APPROVED_STATUS_CODE,
        comment: `Not required to act - already approved by ${emailAddress}.`,
      })
      .where({ ID: { in: siblingIds } }),
  );

  const siblingEmails = siblingRows.map((row) => row.emailAddress).join(", ");

  LOG.info(
    "Other Level pending approvers auto-resolved:",
    JSON.stringify({ requestId, level: approverRow.level, siblingEmails }),
  );

  await insertRequestHistory(
    request,
    requestId,
    `${siblingEmails} were not required to act - request already approved by ${emailAddress}.`,
  );
}

function buildHeader(requestData, process, supplyType) {
  const postingDate = toSapDate(requestData.postingDate ?? new Date());
  const year = String(requestData.fiscalYear ?? postingDate.slice(0, 4));

  return {
    IV_FM_AREA: "1000",
    IV_PROC: process,
    IV_VERS: "000",
    IV_BUDC: "9F",
    IV_DOCT: "Z001",
    IV_DATE: postingDate,
    IV_FYEAR: year,
    IV_SFYEAR: year,
    IV_SBUDT: "SEND",
    IV_SPERIO: "000",
    IV_RFYEAR: year,
    IV_RBUDT: "RECV",
    IV_RPERIO: "000",
    IV_RESP: String(requestData.requestor ?? "").trim(),
    IV_HDR_TEXT: String(requestData.reason ?? "").trim(),
    IV_SUPL_TYPE: supplyType,
    IV_TEST: S4_TEST_MODE,
    IT_ITEM: [],
  };
}

function buildLineItem(requestData, item, config, amount) {
  return {
    SIGN: config.sign,
    FUNDCTR: String(item.costCentre ?? "").trim(),
    CMMTITM: String(item.glAccount ?? "").trim(),
    MATKL: String(item.material ?? "").trim(),
    DISTKEY: "0",
    QUANTITY: "1",
    PRICE: formatAmount(amount),
    ZSTAT: associationCode(item, "assetStatus"),
    ZDESC: String(item.description ?? "").trim(),
    REFNO: String(requestData.requestNumber ?? "").trim(),
  };
}

function buildPayloads(requestData, items) {
  // Validate the request header, but inspect every amount type configured below.
  getProcess(requestData);
  const supplyType = getSupplyType(requestData);
  const payloads = [];

  for (const config of AMOUNT_CONFIGS) {
    const payload = buildHeader(requestData, config.process, supplyType);

    items.forEach((item, index) => {
      const amount = toAmount(item[config.field]);

      if (!Number.isFinite(amount)) {
        throw createBusinessError(
          400,
          `Line ${index + 1}: field '${config.field}' contains an invalid amount.`,
          `Line ${index + 1} contains an invalid ${config.key} amount.`,
        );
      }

      if (amount < 0) {
        throw createBusinessError(
          400,
          `Line ${index + 1}: field '${config.field}' contains a negative amount.`,
          `Line ${index + 1} contains a negative amount. Use the amount type to determine posting direction.`,
        );
      }

      if (amount > 0) {
        payload.IT_ITEM.push(buildLineItem(requestData, item, config, amount));
      }
    });

    if (payload.IT_ITEM.length) {
      payloads.push({
        key: config.key,
        process: config.process,
        direction: config.direction,
        documentField: config.documentField,
        payload,
      });
    }
  }

  if (!payloads.length) {
    throw createBusinessError(
      400,
      "No populated amount was found in the request items.",
      "No valid amount was found in the request items.",
    );
  }

  return payloads;
}

function validatePayload({ key, payload }) {
  const errors = [];

  if (!payload.IV_RESP) errors.push("Budget Officer or Requestor is missing.");
  if (!payload.IT_ITEM.length)
    errors.push("At least one line item is required.");

  payload.IT_ITEM.forEach((item, index) => {
    const line = index + 1;
    if (!item.FUNDCTR) errors.push(`Line ${line}: Cost Center is missing.`);
    if (!item.CMMTITM)
      errors.push(`Line ${line}: GL or commitment item is missing.`);
    if (!Number.isFinite(Number(item.PRICE)))
      errors.push(`Line ${line}: Amount is invalid.`);
    if (!item.REFNO) errors.push(`Line ${line}: Request Number is missing.`);
  });

  if (errors.length) {
    throw createBusinessError(
      400,
      `S/4 payload '${key}' validation failed: ${errors.join(" ")}`,
      `The ${key} payload contains missing or invalid posting information. ${errors.slice(0, 3).join(" ")}`,
    );
  }
}

function validateTransferBalance(payloads) {
  const transferOut = payloads.find(({ key }) => key === "TRAN_OUT");
  const transferIn = payloads.find(({ key }) => key === "TRAN_IN");

  if (!transferOut && !transferIn) return;

  if (!transferOut || !transferIn) {
    throw createBusinessError(
      400,
      "A transfer requires both Transfer Out and Transfer In payloads.",
      "A Transfer request must contain both Transfer Out and Transfer In amounts.",
    );
  }

  const total = ({ payload }) =>
    payload.IT_ITEM.reduce((sum, item) => sum + Number(item.PRICE), 0);

  const outTotal = total(transferOut);
  const inTotal = total(transferIn);

  if (Math.round(outTotal * 100) !== Math.round(inTotal * 100)) {
    throw createBusinessError(
      400,
      `Transfer is not balanced. Out=${outTotal}, In=${inTotal}.`,
      `The Transfer Out total (${formatAmount(outTotal)}) must equal the Transfer In total (${formatAmount(inTotal)}).`,
    );
  }
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildXml(payload) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<n0:ZFM_FI_FMBB_UPLOAD xmlns:n0="urn:sap-com:document:sap:rfc:functions">',
  ];

  HEADER_FIELDS.forEach((field) => {
    lines.push(`  <${field}>${escapeXml(payload[field])}</${field}>`);
  });

  lines.push("  <IT_ITEM>");

  payload.IT_ITEM.forEach((item) => {
    lines.push("    <item>");
    ITEM_FIELDS.forEach((field) => {
      lines.push(`      <${field}>${escapeXml(item[field])}</${field}>`);
    });
    lines.push("    </item>");
  });

  lines.push("  </IT_ITEM>", "</n0:ZFM_FI_FMBB_UPLOAD>");
  return lines.join("\n");
}

async function postToCpi(payload, payloadKey) {
  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    throw new Error(`Destination '${DESTINATION_NAME}' was not found.`);
  }

  const configuredUrl =
    destination.originalProperties?.destinationConfiguration?.URL ||
    destination.url;

  if (!configuredUrl) {
    throw new Error(`Destination '${DESTINATION_NAME}' has no URL configured.`);
  }

  const baseUrl = String(configuredUrl).replace(/\/$/, "");
  const url = baseUrl.endsWith(RFC_ENDPOINT)
    ? baseUrl
    : `${baseUrl}${RFC_ENDPOINT}`;
  const xml = buildXml(payload);

  LOG.info("Sending payload to CPI", {
    payloadKey,
    process: payload.IV_PROC,
    itemCount: payload.IT_ITEM.length,
    xml,
  });

  try {
    const response = await executeHttpRequest(destination, {
      method: "POST",
      url,
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml",
      },
      data: xml,
    });

    return response?.data;
  } catch (error) {
    error.failedPayloadKey = payloadKey;
    error.cpiStatus = error.response?.status;
    error.cpiResponse = error.response?.data;

    LOG.error("CPI HTTP request failed", {
      payloadKey,
      httpStatus: error.cpiStatus,
      responseBody: error.cpiResponse,
    });

    throw error;
  }
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

async function parseResponse(rawResponse) {
  let response = Buffer.isBuffer(rawResponse)
    ? rawResponse.toString("utf8")
    : rawResponse;

  if (typeof response === "string") {
    if (!response.trim())
      return { messages: [], errors: [], documentNumber: "" };
    response = await xmlParser.parseStringPromise(response);
  }

  const returnTable = findXmlValue(response, "ET_RETURN");
  const rawMessages = findXmlValue(returnTable, "item") ?? returnTable ?? [];
  const values = Array.isArray(rawMessages) ? rawMessages : [rawMessages];

  const messages = values
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      type: String(findXmlValue(item, "TYPE") ?? "").trim(),
      message: String(findXmlValue(item, "MESSAGE") ?? "").trim(),
      messageV1: String(findXmlValue(item, "MESSAGE_V1") ?? "").trim(),
      messageV2: String(findXmlValue(item, "MESSAGE_V2") ?? "").trim(),
      messageV3: String(findXmlValue(item, "MESSAGE_V3") ?? "").trim(),
      messageV4: String(findXmlValue(item, "MESSAGE_V4") ?? "").trim(),
    }));

  return {
    messages,
    errors: messages.filter(({ type }) =>
      ["E", "A"].includes(type.toUpperCase()),
    ),
    documentNumber: String(
      findXmlValue(response, "EV_DOC_NUMBER") ??
        findXmlValue(response, "EV_DOCNUMBER") ??
        findXmlValue(response, "EV_BELNR") ??
        "",
    ).trim(),
  };
}

function s4BusinessMessage(errors) {
  const messages = errors.map(({ message }) => message).filter(Boolean);
  return messages.length
    ? messages.slice(0, 3).join(" ").slice(0, 1000)
    : "S/4 rejected the posting request. Please review the request and try again.";
}

function cpiSuccessMessage(postings) {
  const successMessages = postings.flatMap((posting) =>
    posting.messages
      .filter((message) => message.type.toUpperCase() === "S")
      .map((message) => message.message)
      .filter(Boolean),
  );

  if (successMessages.length) {
    return successMessages.join(" ").slice(0, 1000);
  }

  const informationMessages = postings.flatMap((posting) =>
    posting.messages
      .filter((message) => message.type.toUpperCase() === "I")
      .map((message) => message.message)
      .filter(Boolean),
  );

  return informationMessages.length
    ? informationMessages.join(" ").slice(0, 1000)
    : "Request processed successfully by S/4.";
}

function documentNumber(result) {
  const successMessage = result.messages.find(
    (message) =>
      message.type.toUpperCase() === "S" &&
      String(message.messageV3 ?? "").trim(),
  );

  return String(successMessage?.messageV3 ?? "")
    .trim()
    .slice(0, 20);
}

async function updateSuccessfulRequest(tx, requestId, approvedBy, postings) {
  const now = new Date();
  const changes = {
    status_code: POSTED_STATUS_CODE,
    approvedBy: String(approvedBy ?? "").slice(0, 100),
    postingDate: now.toISOString().slice(0, 10),
    postingPeriod: now.getMonth() + 1,
  };

  for (const posting of postings) {
    if (!posting.documentField) {
      throw new Error(
        `No document-number field is configured for '${posting.key}'.`,
      );
    }

    changes[posting.documentField] = String(posting.documentNumber ?? "").slice(
      0,
      20,
    );
  }

  const affected = await tx.run(
    UPDATE(`${SERVICE_NAMESPACE}.Requests`)
      .set(changes)
      .where({ ID: requestId }),
  );

  if (Number(affected) !== 1) {
    throw new Error(
      `Request '${requestId}' could not be updated after successful posting.`,
    );
  }

  return changes;
}

function extractCpiMessage(responseData) {
  if (typeof responseData === "string") {
    return responseData
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (responseData && typeof responseData === "object") {
    return String(
      responseData.message ??
        responseData.error?.message ??
        responseData.error ??
        "",
    ).trim();
  }

  return "";
}

function businessError(error) {
  if (error.userMessage) {
    return { status: error.statusCode || 400, message: error.userMessage };
  }

  const text = String(error.message || "");
  const lower = text.toLowerCase();

  if (lower.includes("already posted")) {
    return {
      status: 409,
      message: "This request has already been posted to S/4.",
    };
  }

  if (lower.includes("no document number")) {
    return {
      status: 502,
      message:
        "S/4 processed a payload but did not return a document number. Please do not repost it and contact support.",
    };
  }

  if (text.includes("CDS compilation failed") || text.includes("Mismatched")) {
    return {
      status: 500,
      message:
        "The request could not be retrieved due to a system issue. Please contact support.",
    };
  }

  if (error.response?.status) {
    const status = Number(error.response.status);
    const cpiMessage = extractCpiMessage(error.response.data).slice(0, 1000);

    if (status === 400 || status === 422) {
      return {
        status: 422,
        message: cpiMessage || "CPI or S/4 rejected the generated payload.",
      };
    }
    if (status === 401 || status === 403) {
      return {
        status: 502,
        message:
          "CPI rejected the request authentication or authorization. Please contact support.",
      };
    }
    if (status === 404) {
      return {
        status: 502,
        message:
          "The configured CPI endpoint was not found. Please verify the destination and endpoint path.",
      };
    }
    if (status >= 500) {
      return {
        status: 502,
        message:
          cpiMessage ||
          "CPI received the payload but failed while processing it. Please check the CPI message monitor.",
      };
    }
  }

  if (text.includes("Destination")) {
    return {
      status: 503,
      message:
        "The CPI destination could not be loaded. Please verify the destination configuration.",
    };
  }

  return {
    status: 500,
    message:
      "An unexpected error occurred while posting to S/4. Please try again or contact support.",
  };
}

/**
 * Core, reusable S/4 posting logic. Callable directly, in-process,
 * from approveRequest (no HTTP round trip through BPA needed),
 * since the caller already knows requestId and emailAddress at the
 * moment of approval.
 *
 * Throws on business/technical errors; callers are responsible for
 * catching and converting to the appropriate response (request.error
 * for a CAP action context, or a rethrow for callers doing their
 * own error handling).
 *
 * @param {object} options
 * @param {object} options.tx - an active cds.tx() transaction
 * @param {cds.Request} options.request - needed for history logging
 * @param {string} options.requestId
 * @param {string} options.emailAddress - the approver's email
 * @returns {Promise<object>} the posting result object
 */
async function performPostToS4({ tx, request, requestId, emailAddress }) {
  const postings = [];

  await markApproverApproved(tx, request, requestId, emailAddress);

  const { requestData, items } = await fetchRequestWithItems(requestId, tx);

  const populatedConfigs = AMOUNT_CONFIGS.filter((config) =>
    items.some((item) => toAmount(item[config.field]) > 0),
  );

  const alreadyPosted =
    populatedConfigs.length > 0 &&
    populatedConfigs.every((config) =>
      Boolean(requestData[config.documentField]),
    );

  if (alreadyPosted) {
    throw createBusinessError(
      409,
      "Request was already posted.",
      "This request has already been posted to S/4.",
    );
  }

  if (!items.length) {
    throw createBusinessError(
      400,
      "Request has no line items.",
      "The request cannot be posted because it has no line items.",
    );
  }

  const payloads = buildPayloads(requestData, items).filter(
    (descriptor) => !requestData[descriptor.documentField],
  );

  if (!payloads.length) {
    throw createBusinessError(
      409,
      "Request was already posted.",
      "This request has already been posted to S/4.",
    );
  }

  payloads.forEach(validatePayload);
  validateTransferBalance(payloads);

  for (const descriptor of payloads) {
    const result = await parseResponse(
      await postToCpi(descriptor.payload, descriptor.key),
    );

    if (result.errors.length) {
      throw createBusinessError(
        422,
        s4BusinessMessage(result.errors),
        s4BusinessMessage(result.errors),
      );
    }

    let docNumber = "";

    if (S4_TEST_MODE !== "X") {
      docNumber = documentNumber(result);

      if (!docNumber) {
        throw new Error(
          `S/4 reported success for ${descriptor.key}, but no document number was returned.`,
        );
      }
    }

    postings.push({
      key: descriptor.key,
      process: descriptor.payload.IV_PROC,
      direction: descriptor.direction,
      documentField: descriptor.documentField,
      documentNumber: docNumber,
      messages: result.messages,
    });
  }

  if (S4_TEST_MODE === "X") {
    postings.forEach((posting) => {
      posting.documentNumber = generateTestDocumentNumber();
    });
  }

  const updated = await updateSuccessfulRequest(
    tx,
    requestId,
    emailAddress,
    postings,
  );

  const successMessage = cpiSuccessMessage(postings);

  return {
    success: true,
    simulated: S4_TEST_MODE === "X",
    message: successMessage,
    requestId,
    payloadCount: postings.length,
    documentNumbers: Object.fromEntries(
      postings.map(({ key, documentNumber }) => [key, documentNumber]),
    ),
    statusCode: updated.status_code,
    postingDate: updated.postingDate,
    postingPeriod: updated.postingPeriod,
    postings,
    errors: [],
  };
}

/*
 * UNBOUND CAP action wrapper: this.on("postToS4", postToS4)
 *
 * Kept for flexibility (e.g. manual testing via the Actions
 * catalog, or a future admin-triggered retry action). Not used by
 * the standard Approve flow anymore - approveRequest now calls
 * performPostToS4 directly, in-process.
 */
module.exports = async function postToS4(request) {
  const requestId = request.data?.requestId;
  const emailAddress = request.data?.emailAddress;

  try {
    if (!requestId) {
      return request.reject(
        400,
        "requestId is required to post a request to S/4.",
      );
    }

    const tx = cds.tx(request);

    return await performPostToS4({ tx, request, requestId, emailAddress });
  } catch (error) {
    const safe = businessError(error);

    LOG.error("Error while posting request to S/4", {
      requestId,
      errorMessage: error.message,
      failedPayloadKey: error.failedPayloadKey,
      cpiStatus: error.cpiStatus,
      cpiResponse: error.cpiResponse,
      stack: error.stack,
    });

    return request.reject(safe.status, safe.message);
  }
};

module.exports.performPostToS4 = performPostToS4;
module.exports.businessError = businessError;
