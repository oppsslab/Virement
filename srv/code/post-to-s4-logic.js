"use strict";

const cds = require("@sap/cds");
const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const xml2js = require("xml2js");

const LOG = cds.log("post-to-s4-logic");
const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const DESTINATION_NAME = "CPI";
const RFC_ENDPOINT = "/http/ZFM_FI_FMBB_UPLOAD";
const TIMEOUT_MS = 30000;

// Replace this with the actual RequestStatus key for a successfully posted request.
const POSTED_STATUS_CODE = 3;

// Manual posting mode: "X" = simulation, "" = actual posting.
const S4_TEST_MODE = "X";

const PROCESS_TYPES = Object.freeze({
  S: "SUPL",
  R: "RETN",
  T: "TRAN",
});

const BUDGET_TYPES = Object.freeze({
  P: "PROJECT",
  N: "NONPROJ",
});

const DEFAULTS = Object.freeze({
  FM_AREA: "1000",
  VERSION: "0",
  BUDGET_CATEGORY: "9F",
  DOC_TYPE: "Z001",
  SENDER_BUDGET_TYPE: "SEND",
  RECEIVER_BUDGET_TYPE: "RECV",
  SENDER_PERIOD: "000",
  RECEIVER_PERIOD: "000",
});

const xmlParser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });

function associationCode(entity, name) {
  return String(
    entity?.[name]?.code ?? entity?.[`${name}_code`] ?? entity?.[name] ?? "",
  ).trim();
}

function processType(requestData) {
  const code = associationCode(requestData, "requestType").toUpperCase();
  const value = PROCESS_TYPES[code];

  if (!value) {
    const error = new Error(
      `Unsupported request type code '${code || "blank"}'.`,
    );
    error.statusCode = 400;
    error.userMessage =
      "Only Supplement, Return, and Transfer requests can be posted to S/4.";
    throw error;
  }

  return value;
}

function supplyType(requestData) {
  const code = associationCode(requestData, "budgetType").toUpperCase();
  const value = BUDGET_TYPES[code];

  if (!value) {
    const error = new Error(
      `Unsupported budget type code '${code || "blank"}'.`,
    );
    error.statusCode = 400;
    error.userMessage =
      "Please select either Project or Non-Project before posting to S/4.";
    throw error;
  }

  return value;
}

function sapDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid posting date '${value}'.`);
  return date.toISOString().slice(0, 10);
}

async function fetchRequestWithItems(requestId, tx) {
  // Avoid columns("requestType.*") because some CAP versions cannot compile it.
  // The generated foreign keys requestType_code, budgetType_code, status_code,
  // assetStatus_code, and type_code are sufficient for this mapping.
  const requestData = await tx.run(
    SELECT.one.from(`${SERVICE_NAMESPACE}.Requests`).where({ ID: requestId }),
  );

  if (!requestData) {
    const error = new Error(`Request '${requestId}' was not found.`);
    error.statusCode = 404;
    error.userMessage =
      "The selected request could not be found. Please refresh the page and try again.";
    throw error;
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

function itemSign(item, type) {
  if (["+", "-"].includes(item.sign)) return item.sign;
  const direction = String(item.direction ?? item.lineType ?? "").toUpperCase();
  if (["SENDER", "OUT", "TRANSFER_OUT"].includes(direction)) return "-";
  if (["RECEIVER", "IN", "TRANSFER_IN"].includes(direction)) return "+";
  if (type === "TRAN") {
    LOG.warn("Transfer line has no direction; SIGN defaults to '+'", { itemId: item.ID });
  }
  return "+";
}

function buildPayload(requestData, items, currentUser) {
  const type = processType(requestData);
  const budgetMode = supplyType(requestData);
  const year = String(requestData.fiscalYear ?? new Date().getFullYear());

  const lineItems = items.map((item) => {
    const gl = String(item.glAccount ?? item.gl ?? item.commitmentItem ?? "").trim();
    const wbs = String(item.wbs ?? item.wbsElement ?? "").trim();
    const material = String(item.material ?? item.materialGroup ?? "").trim();
    const commitmentItem = budgetMode === "PROJECT" ? wbs || gl : gl;

    return {
      SIGN: itemSign(item, type),
      FUNDCTR: String(item.costCentre ?? item.costCenter ?? item.fundCenter ?? "").trim(),
      CMMTITM: commitmentItem,
      MATKL: budgetMode === "NONPROJ" ? commitmentItem.slice(0, 6) : material.slice(0, 6),
      DISTKEY: "0",
      QUANTITY: "1",
      PRICE: String(item.amount ?? 0),
      ZSTAT: associationCode(item, "assetStatus"),
      ZDESC: String(item.description ?? ""),
      REFNO: String(item.refNo ?? item.referenceNumber ?? item.srNo ?? ""),
    };
  });

  return {
    IV_FM_AREA: DEFAULTS.FM_AREA,
    IV_PROC: type,
    IV_VERS: DEFAULTS.VERSION,
    IV_BUDC: DEFAULTS.BUDGET_CATEGORY,
    IV_DOCT: DEFAULTS.DOC_TYPE,
    IV_DATE: sapDate(requestData.documentDate ?? requestData.submissionDate),
    IV_FYEAR: year,
    IV_SFYEAR: year,
    IV_RFYEAR: year,
    IV_SBUDT: DEFAULTS.SENDER_BUDGET_TYPE,
    IV_RBUDT: DEFAULTS.RECEIVER_BUDGET_TYPE,
    IV_SPERIO: DEFAULTS.SENDER_PERIOD,
    IV_RPERIO: DEFAULTS.RECEIVER_PERIOD,
    IV_TEST: S4_TEST_MODE === "X" ? "X" : "",
    IV_RESP: String(
      requestData.budgetOfficer ?? requestData.budgetOfficerId ??
      requestData.approvedBy ?? currentUser ?? requestData.requestor ?? "",
    ),
    IV_HDR_TEXT: String(requestData.reason ?? ""),
    IV_SUPL_TYPE: budgetMode,
    IT_ITEM: lineItems,
  };
}

function validatePayload(payload) {
  const errors = [];
  if (!payload.IV_RESP) errors.push("Budget Officer is missing.");
  if (!payload.IT_ITEM.length) errors.push("At least one line item is required.");

  payload.IT_ITEM.forEach((item, index) => {
    const line = index + 1;
    if (!item.CMMTITM) errors.push(`Line ${line}: GL account or WBS is missing.`);
    if (payload.IV_SUPL_TYPE === "NONPROJ" && !item.FUNDCTR) {
      errors.push(`Line ${line}: Cost Center is missing.`);
    }
    if (!Number.isFinite(Number(item.PRICE))) errors.push(`Line ${line}: Amount is invalid.`);
  });

  if (errors.length) {
    const error = new Error(`S/4 payload validation failed: ${errors.join(" ")}`);
    error.statusCode = 400;
    error.userMessage =
      "The request contains missing or invalid posting information. " +
      "Please review the request header and line items.";
    throw error;
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
  const headers = [
    "IV_FM_AREA", "IV_PROC", "IV_VERS", "IV_BUDC", "IV_DOCT", "IV_DATE",
    "IV_FYEAR", "IV_SFYEAR", "IV_SBUDT", "IV_SPERIO", "IV_RFYEAR",
    "IV_RBUDT", "IV_RPERIO", "IV_RESP", "IV_HDR_TEXT", "IV_SUPL_TYPE", "IV_TEST",
  ];
  const itemFields = [
    "SIGN", "FUNDCTR", "CMMTITM", "MATKL", "DISTKEY", "QUANTITY",
    "PRICE", "ZSTAT", "ZDESC", "REFNO",
  ];
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<n0:ZFM_FI_FMBB_UPLOAD xmlns:n0="urn:sap-com:document:sap:rfc:functions">',
  ];
  headers.forEach((field) => lines.push(`  <${field}>${escapeXml(payload[field])}</${field}>`));
  lines.push("  <IT_ITEM>");
  payload.IT_ITEM.forEach((item) => {
    lines.push("    <item>");
    itemFields.forEach((field) => lines.push(`      <${field}>${escapeXml(item[field])}</${field}>`));
    lines.push("    </item>");
  });
  lines.push("  </IT_ITEM>", "</n0:ZFM_FI_FMBB_UPLOAD>");
  return lines.join("\n");
}

async function postToCpi(payload) {
  const destination = await getDestination({ destinationName: DESTINATION_NAME });
  if (!destination) throw new Error(`Destination '${DESTINATION_NAME}' was not found.`);

  const baseUrl = destination.originalProperties?.destinationConfiguration?.URL || destination.url;
  if (!baseUrl) throw new Error(`Destination '${DESTINATION_NAME}' has no URL configured.`);

  const response = await executeHttpRequest(destination, {
    method: "POST",
    url: `${String(baseUrl).replace(/\/$/, "")}${RFC_ENDPOINT}`,
    headers: { "Content-Type": "application/xml", Accept: "application/xml" },
    data: buildXml(payload),
    timeout: TIMEOUT_MS,
  });
  return response?.data;
}

async function parseResponse(rawResponse) {
  let response = rawResponse;
  if (typeof rawResponse === "string") {
    const parsed = await xmlParser.parseStringPromise(rawResponse);
    response =
      parsed["rfc:ZFM_FI_FMBB_UPLOAD.Response"] ||
      parsed["n0:ZFM_FI_FMBB_UPLOAD.Response"] ||
      parsed["ZFM_FI_FMBB_UPLOAD.Response"] ||
      Object.values(parsed)[0];
  }

  const rawMessages = response?.ET_RETURN?.item ?? response?.ET_RETURN ?? [];
  const values = Array.isArray(rawMessages) ? rawMessages : [rawMessages];
  const messages = values.filter(Boolean).map((msg) => ({
    type: String(msg.TYPE ?? ""),
    id: String(msg.ID ?? ""),
    number: String(msg.NUMBER ?? ""),
    message: String(msg.MESSAGE ?? ""),
    messageV1: String(msg.MESSAGE_V1 ?? ""),
    messageV2: String(msg.MESSAGE_V2 ?? ""),
    messageV3: String(msg.MESSAGE_V3 ?? ""),
    messageV4: String(msg.MESSAGE_V4 ?? ""),
    parameter: String(msg.PARAMETER ?? ""),
    row: String(msg.ROW ?? ""),
    field: String(msg.FIELD ?? ""),
  }));

  return {
    messages,
    errors: messages.filter((msg) => ["E", "A"].includes(msg.type.toUpperCase())),
    explicitDocumentNumber: String(
      response?.EV_DOC_NUMBER ?? response?.EV_DOCNUMBER ?? response?.EV_BELNR ?? "",
    ).trim(),
  };
}

function documentNumber(result) {
  if (result.explicitDocumentNumber) return result.explicitDocumentNumber.slice(0, 20);
  for (const msg of result.messages) {
    if (!["S", "I"].includes(msg.type.toUpperCase())) continue;
    for (const value of [msg.messageV1, msg.messageV2, msg.messageV3, msg.messageV4]) {
      if (value.trim()) return value.trim().slice(0, 20);
    }
  }
  return "";
}

async function updateSuccessfulRequest(tx, requestId, approvedBy, docNumber) {
  const now = new Date();
  const changes = {
    status_code: POSTED_STATUS_CODE,
    approvedBy: String(approvedBy ?? "").slice(0, 100),
    docNumber: String(docNumber).slice(0, 20),
    postingDate: now.toISOString().slice(0, 10),
    postingPeriod: now.getMonth() + 1,
  };

  const affected = await tx.run(
    UPDATE(`${SERVICE_NAMESPACE}.Requests`).set(changes).where({ ID: requestId }),
  );
  if (Number(affected) !== 1) {
    throw new Error(`Request '${requestId}' could not be updated after successful posting.`);
  }
  return changes;
}

function s4BusinessMessage(errors) {
  const messages = errors.map((entry) => entry.message).filter(Boolean);
  return messages.length
    ? messages.slice(0, 3).join(" ").slice(0, 1000)
    : "S/4 rejected the posting request. Please review the request and try again.";
}

function businessError(error) {
  if (error.userMessage) {
    return { status: error.statusCode || 400, message: error.userMessage };
  }

  const text = String(error.message || "");
  const lower = text.toLowerCase();
  if (text.includes("already posted")) {
    return { status: 409, message: "This request has already been posted to S/4." };
  }
  if (error.code === "ETIMEDOUT" || error.code === "ECONNABORTED" || lower.includes("timeout")) {
    return {
      status: 504,
      message: "S/4 did not respond in time. Please check the request status before trying again.",
    };
  }
  if (text.includes("no document number")) {
    return {
      status: 502,
      message:
        "S/4 processed the request but did not return a document number. " +
        "Please do not repost it and contact support.",
    };
  }
  if (text.includes("CDS compilation failed") || text.includes("Mismatched")) {
    return {
      status: 500,
      message: "The request could not be retrieved due to a system issue. Please contact support.",
    };
  }
  if (text.includes("Destination") || error.response?.status) {
    return {
      status: 503,
      message: "The posting service is temporarily unavailable. Please try again later.",
    };
  }
  return {
    status: 500,
    message: "An unexpected error occurred while posting to S/4. Please try again or contact support.",
  };
}

// Bound action declaration: this.on("postToS4", "Requests", post_To_S4_Logic)
module.exports = async function post_To_S4_Logic(request) {
  const requestId = request.params?.[0]?.ID;
  let payload;

  try {
    if (!requestId) {
      return request.reject(400, "The selected request could not be identified.");
    }

    const tx = cds.tx(request);
    const { requestData, items } = await fetchRequestWithItems(requestId, tx);

    if (requestData.docNumber) {
      const error = new Error("Request was already posted.");
      error.statusCode = 409;
      error.userMessage =
        `This request has already been posted under S/4 document '${requestData.docNumber}'.`;
      throw error;
    }
    if (!items.length) {
      const error = new Error("Request has no line items.");
      error.statusCode = 400;
      error.userMessage = "The request cannot be posted because it has no line items.";
      throw error;
    }

    payload = buildPayload(requestData, items, request.user?.id);
    validatePayload(payload);
    const result = await parseResponse(await postToCpi(payload));

    if (result.errors.length) {
      const s4ErrorMessage = s4BusinessMessage(result.errors);
      const error = new Error(s4ErrorMessage);
      error.statusCode = 422;
      error.userMessage = s4ErrorMessage;
      error.isS4BusinessError = true;
      throw error;
    }

    if (payload.IV_TEST === "X") {
      return {
        success: true,
        simulated: true,
        requestId,
        documentNumber: "",
        statusCode: null,
        postingDate: null,
        postingPeriod: null,
        messages: result.messages,
        errors: [],
      };
    }

    const docNumber = documentNumber(result);
    if (!docNumber) throw new Error("S/4 reported success but no document number was returned.");

    const updated = await updateSuccessfulRequest(
      tx,
      requestId,
      request.user?.id,
      docNumber,
    );

    return {
      success: true,
      simulated: false,
      requestId,
      documentNumber: docNumber,
      statusCode: updated.status_code,
      postingDate: updated.postingDate,
      postingPeriod: updated.postingPeriod,
      messages: result.messages,
      errors: [],
    };
  } catch (error) {
    const safe = businessError(error);

    const errorLog = {
      message: "Error while posting request to S/4",
      user: request.user?.id,
      errorMessage: error.message,
      stack: error.stack,
    };

    // Include the generated S/4 payload only when payload creation succeeded.
    if (payload) {
      errorLog.payload = payload;
    }

    LOG.error(errorLog);

    return request.reject(safe.status, safe.message);
  }
};