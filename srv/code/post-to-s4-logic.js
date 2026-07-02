const cds = require("@sap/cds");
const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const xml2js = require("xml2js");

const LOG = cds.log("post-to-s4-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const DESTINATION_NAME = "CPI";
const RFC_ENDPOINT = "/http/ZFM_FI_FMBB_UPLOAD";
const TIMEOUT_MS = 30000;
const USE_HARDCODED_PAYLOAD = true;

const xmlParser = new xml2js.Parser({
  explicitArray: false,
  mergeAttrs: true,
});

const PROCESS_TYPES = {
  ENTRY: "ENTR",
  SUPPLY: "SUPL",
  RETURN: "RETN",
  TRANSFER: "TRAN",
  COVER: "COVR",
};

const DEFAULT_HEADER_VALUES = {
  FM_AREA: "1000",
  VERSION: "0",
  BUDGET_CATEGORY: "9F",
  DOC_TYPE: "Z001",
  SENDER_BUDGET_TYPE: "SEND",
  RECEIVER_BUDGET_TYPE: "RECV",
  SENDER_PERIOD: "000",
  RECEIVER_PERIOD: "000",
  SUPPLY_TYPE: "NONPROJ",
  TEST_MODE: "X",
};

/**
 * Hardcoded test payload for testing the CPI/S4 integration.
 * Corrected to pass S/4 validations.
 */
function getHardcodedTestData() {
  return {
    request: {
      ID: "00000000-0000-0000-0000-000000000001",
      requestNumber: "REQ-2026-00001",
      requestType: {
        code: "TRAN",
        name: "Transfer",
      },
      budgetType: {
        code: "NONPROJECT",
        name: "Non-Project",
      },
      status: {
        code: 1,
        name: "Draft",
      },
      fiscalYear: 2026,
      submissionDate: new Date("2026-06-23"),
      requestor: "P000123",
      requestorCostCentre: "CC0001",
      totalAmount: 5000.0,
      approverComment: "Test budget transfer via API",
      reason: "Budget reallocation for Q2 operations",
    },
    items: [
      {
        ID: "00000000-0000-0000-0000-000000000101",
        request_ID: "00000000-0000-0000-0000-000000000001",
        srNo: "1",
        costCentre: "100001",
        glAccount: "410100",
        material: "MAT001",
        wbs: "WBS0001",
        assetStatus: {
          code: "ACTIVE",
          name: "Active",
        },
        type: {
          code: "ASSET",
          name: "Asset",
        },
        amount: 2500.0,
        description: "Office Equipment Budget",
      },
      {
        ID: "00000000-0000-0000-0000-000000000102",
        request_ID: "00000000-0000-0000-0000-000000000001",
        srNo: "2",
        costCentre: "100002",
        glAccount: "410200",
        material: "MAT002",
        wbs: "WBS0002",
        assetStatus: {
          code: "ACTIVE",
          name: "Active",
        },
        type: {
          code: "ASSET",
          name: "Asset",
        },
        amount: 2500.0,
        description: "IT Infrastructure Budget",
      },
    ],
  };
}

async function getCpiDestination() {
  LOG.info("Retrieving destination:", DESTINATION_NAME);

  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    throw new Error(`Destination '${DESTINATION_NAME}' not found.`);
  }

  const originalProperties = destination.originalProperties;
  if (!originalProperties) {
    throw new Error(
      `Destination '${destination.name}' has no originalProperties.`,
    );
  }

  const destinationConfiguration = originalProperties.destinationConfiguration;
  const url = destinationConfiguration?.URL;

  if (!url) {
    throw new Error(`Destination '${destination.name}' has no URL configured.`);
  }

  LOG.info("Destination retrieved successfully:", {
    name: destination.name,
    url,
  });

  return { destination, url };
}

async function fetchRequestWithItems(requestId, tx) {
  const request = await tx.run(
    SELECT.one
      .from(`${SERVICE_NAMESPACE}.Requests`, (q) =>
        q.columns(
          (c) => c`*`,
          (c) => c.requestType`.*`,
          (c) => c.budgetType`.*`,
          (c) => c.status`.*`,
        ),
      )
      .where({ ID: requestId }),
  );

  if (!request) {
    throw new Error(`Request with ID '${requestId}' not found.`);
  }

  const items = await tx.run(
    SELECT.from(`${SERVICE_NAMESPACE}.RequestItems`, (q) =>
      q.columns(
        (c) => c`*`,
        (c) => c.assetStatus`.*`,
        (c) => c.type`.*`,
      ),
    ).where({ request_ID: requestId }),
  );

  LOG.info("Fetched request and items:", {
    requestId,
    requestNumber: request.requestNumber,
    itemCount: items?.length || 0,
  });

  return { request, items };
}

function mapRequestItemToLineItem(item, request) {
  const sign = request.requestType?.code === "TRAN" ? "+" : "+";

  return {
    sign,
    fundctr: item.costCentre || "",
    cmmtitm: item.wbs || item.glAccount || "",
    matkl: item.material ? item.material.substring(0, 6) : "",
    distkey: "0",
    quantity: 1,
    price: item.amount || 0,
    zstat: item.assetStatus?.code || "",
    zdesc: item.description || "",
    refno: item.srNo || "",
  };
}

function buildLineItem(lineItem) {
  // If MATKL is empty, use first 6 chars of CMMTITM
  let matkl = lineItem.matkl || "";
  if (!matkl && lineItem.cmmtitm) {
    matkl = lineItem.cmmtitm.substring(0, 6);
  }

  return {
    SIGN: lineItem.sign || "+",
    FUNDCTR: lineItem.fundctr || "",
    CMMTITM: lineItem.cmmtitm || "",
    MATKL: matkl,
    DISTKEY: lineItem.distkey || "0",
    QUANTITY: String(lineItem.quantity || 0),
    PRICE: String(lineItem.price || 0),
    ZSTAT: lineItem.zstat || "",
    ZDESC: lineItem.zdesc || "",
    REFNO: lineItem.refno || "",
  };
}

function formatDateForSap(date) {
  if (!date) {
    return new Date().toISOString().split("T")[0];
  }
  if (typeof date === "string") {
    return date;
  }
  return date.toISOString().split("T")[0];
}

function mapRequestToHeaderParams(request) {
  const requestTypeCode = request.requestType?.code || "ENTR";

  return {
    processType: PROCESS_TYPES[requestTypeCode] || PROCESS_TYPES.ENTRY,
    documentDate: formatDateForSap(request.submissionDate || new Date()),
    fiscalYear:
      request.fiscalYear?.toString() || String(new Date().getFullYear()),
    senderFiscalYear:
      request.fiscalYear?.toString() || String(new Date().getFullYear()),
    receiverFiscalYear:
      request.fiscalYear?.toString() || String(new Date().getFullYear()),
    requestorId: request.requestor || "AUTO",
    headerText: `Request ${request.requestNumber}`,
  };
}

function buildS4Payload(request, items, overrides = {}) {
  const headerParams = mapRequestToHeaderParams(request);
  const lineItems = items.map((item) =>
    mapRequestItemToLineItem(item, request),
  );

  // Determine supply type based on budget type
  let supplyType = DEFAULT_HEADER_VALUES.SUPPLY_TYPE;
  if (request.budgetType?.code === "PROJECT") {
    supplyType = "PROJ";
  } else if (request.budgetType?.code === "NONPROJECT") {
    supplyType = "NONPROJ";
  }

  const payload = {
    IV_FM_AREA: DEFAULT_HEADER_VALUES.FM_AREA,
    IV_PROC: overrides.processType || headerParams.processType,
    IV_VERS: DEFAULT_HEADER_VALUES.VERSION,
    IV_BUDC: DEFAULT_HEADER_VALUES.BUDGET_CATEGORY,
    IV_DOCT: DEFAULT_HEADER_VALUES.DOC_TYPE,
    IV_DATE: overrides.documentDate || headerParams.documentDate,
    IV_FYEAR: overrides.fiscalYear || headerParams.fiscalYear,
    IV_SFYEAR: overrides.senderFiscalYear || headerParams.senderFiscalYear,
    IV_RFYEAR: overrides.receiverFiscalYear || headerParams.receiverFiscalYear,
    IV_SBUDT: DEFAULT_HEADER_VALUES.SENDER_BUDGET_TYPE,
    IV_RBUDT: DEFAULT_HEADER_VALUES.RECEIVER_BUDGET_TYPE,
    IV_SPERIO: DEFAULT_HEADER_VALUES.SENDER_PERIOD,
    IV_RPERIO: DEFAULT_HEADER_VALUES.RECEIVER_PERIOD,
    IV_RESP: overrides.requestorId || headerParams.requestorId,
    IV_HDR_TEXT: overrides.headerText || headerParams.headerText,
    IV_SUPL_TYPE: supplyType,
    IV_TEST: overrides.testMode ?? DEFAULT_HEADER_VALUES.TEST_MODE,
    IT_ITEM: lineItems.map((item) => buildLineItem(item)),
  };

  return payload;
}

/**
 * Parses XML RFC response and extracts ET_RETURN array
 * @param {string} xmlResponse - XML response string
 * @returns {Promise<Array>} Array of return messages
 */
async function parseXmlResponse(xmlResponse) {
  try {
    LOG.info("Parsing XML response");

    const parsed = await xmlParser.parseStringPromise(xmlResponse);

    // Navigate the XML structure
    const response =
      parsed["rfc:ZFM_FI_FMBB_UPLOAD.Response"] ||
      parsed["ZFM_FI_FMBB_UPLOAD.Response"];

    if (!response) {
      LOG.warn("No response structure found in XML");
      return [];
    }

    let etReturn = response.ET_RETURN;

    // Handle single item (converted to object instead of array)
    if (etReturn && !Array.isArray(etReturn)) {
      etReturn = [etReturn];
    }

    LOG.info("ET_RETURN parsed:", JSON.stringify(etReturn, null, 2));

    return etReturn || [];
  } catch (error) {
    LOG.error("Error parsing XML response:", error.message);
    return [];
  }
}

/**
 * Parses RFC response and extracts error/success messages
 */
function parseS4Response(returnMessages) {
  const result = {
    hasErrors: false,
    messages: [],
    errors: [],
  };

  if (!Array.isArray(returnMessages)) {
    return result;
  }

  for (const msg of returnMessages) {
    const entry = {
      type: msg.TYPE || "",
      id: msg.ID || "",
      number: msg.NUMBER || "",
      message: msg.MESSAGE || "",
    };

    result.messages.push(entry);

    // TYPE 'E' = Error, 'W' = Warning, 'I' = Info, 'S' = Success, 'A' = Abort
    if (entry.type === "E" || entry.type === "A") {
      result.hasErrors = true;
      result.errors.push(entry);
    }
  }

  return result;
}

function escapeXml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildRfcXmlPayload(payload) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<n0:ZFM_FI_FMBB_UPLOAD xmlns:n0="urn:sap-com:document:sap:rfc:functions">\n';

  // Add scalar parameters
  xml += `  <IV_FM_AREA>${payload.IV_FM_AREA}</IV_FM_AREA>\n`;
  xml += `  <IV_PROC>${payload.IV_PROC}</IV_PROC>\n`;
  xml += `  <IV_VERS>${payload.IV_VERS}</IV_VERS>\n`;
  xml += `  <IV_BUDC>${payload.IV_BUDC}</IV_BUDC>\n`;
  xml += `  <IV_DOCT>${payload.IV_DOCT}</IV_DOCT>\n`;
  xml += `  <IV_DATE>${payload.IV_DATE}</IV_DATE>\n`;
  xml += `  <IV_FYEAR>${payload.IV_FYEAR}</IV_FYEAR>\n`;
  xml += `  <IV_SFYEAR>${payload.IV_SFYEAR}</IV_SFYEAR>\n`;
  xml += `  <IV_SBUDT>${payload.IV_SBUDT}</IV_SBUDT>\n`;
  xml += `  <IV_SPERIO>${payload.IV_SPERIO}</IV_SPERIO>\n`;
  xml += `  <IV_RFYEAR>${payload.IV_RFYEAR}</IV_RFYEAR>\n`;
  xml += `  <IV_RBUDT>${payload.IV_RBUDT}</IV_RBUDT>\n`;
  xml += `  <IV_RPERIO>${payload.IV_RPERIO}</IV_RPERIO>\n`;
  xml += `  <IV_RESP>${escapeXml(payload.IV_RESP)}</IV_RESP>\n`;
  xml += `  <IV_HDR_TEXT>${escapeXml(payload.IV_HDR_TEXT)}</IV_HDR_TEXT>\n`;
  xml += `  <IV_SUPL_TYPE>${payload.IV_SUPL_TYPE}</IV_SUPL_TYPE>\n`;
  xml += `  <IV_TEST>${payload.IV_TEST}</IV_TEST>\n`;

  // Add table parameter IT_ITEM
  xml += "  <IT_ITEM>\n";
  for (const item of payload.IT_ITEM) {
    xml += "    <item>\n";
    xml += `      <SIGN>${item.SIGN}</SIGN>\n`;
    xml += `      <FUNDCTR>${item.FUNDCTR}</FUNDCTR>\n`;
    xml += `      <CMMTITM>${item.CMMTITM}</CMMTITM>\n`;
    xml += `      <MATKL>${item.MATKL}</MATKL>\n`;
    xml += `      <DISTKEY>${item.DISTKEY}</DISTKEY>\n`;
    xml += `      <QUANTITY>${item.QUANTITY}</QUANTITY>\n`;
    xml += `      <PRICE>${item.PRICE}</PRICE>\n`;
    xml += `      <ZSTAT>${item.ZSTAT}</ZSTAT>\n`;
    xml += `      <ZDESC>${escapeXml(item.ZDESC)}</ZDESC>\n`;
    xml += `      <REFNO>${item.REFNO}</REFNO>\n`;
    xml += "    </item>\n";
  }
  xml += "  </IT_ITEM>\n";

  xml += "</n0:ZFM_FI_FMBB_UPLOAD>";

  return xml;
}

async function postDocumentToCpi(cpiDest, payload) {
  const xmlPayload = buildRfcXmlPayload(payload);
  const payloadSize = Buffer.byteLength(xmlPayload, "utf8");
  const recordCount = payload.IT_ITEM?.length || 0;
  const fullUrl = `${cpiDest.url}${RFC_ENDPOINT}`;

  LOG.info({
    msg: "POST to CPI/S4 started",
    destinationName: DESTINATION_NAME,
    baseUrl: cpiDest.url,
    rfcEndpoint: RFC_ENDPOINT,
    fullUrl,
    payloadSizeBytes: payloadSize,
    recordCount,
  });

  LOG.info(`XML Payload:\n${xmlPayload}`);

  try {
    const response = await executeHttpRequest(cpiDest.destination, {
      method: "POST",
      url: fullUrl,
      headers: {
        "Content-Type": "application/xml",
        Accept: "application/xml",
      },
      data: xmlPayload,
      timeout: TIMEOUT_MS,
    });

    let responseData = response?.data;

    LOG.info({
      msg: "POST to CPI/S4 completed successfully",
      status: response.status,
      statusText: response.statusText,
      responseSize: Buffer.byteLength(
        JSON.stringify(responseData),
        "utf8",
      ),
    });

    // If response is a string (XML), keep it as is
    if (typeof responseData === "string") {
      LOG.info(`XML Response received: ${responseData}`);
      return responseData;
    }

    LOG.info(`Response: ${JSON.stringify(responseData, null, 2)}`);
    return responseData;
  } catch (error) {
    LOG.error({
      msg: "Failed to post document to CPI/S4",
      error: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: JSON.stringify(error.response?.data, null, 2),
    });

    throw error;
  }
}

/**
 * Posts a Request (with its items) to S/4 via CPI.
 * Fetches data from the database (or uses hardcoded test data if enabled),
 * builds the payload, calls CPI, and parses the response.
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Promise<Object>} { success, messages, errors }
 */
module.exports = async function (request) {
  LOG.info("postToS4 action started");

  try {
    const params = request.data;

    LOG.info("Action params:", JSON.stringify(params || {}));
    LOG.info("Using hardcoded payload:", USE_HARDCODED_PAYLOAD);

    // 1. Validate input
    if (!params || !params.requestId) {
      LOG.warn("Validation failed: requestId is required.");
      return request.error(400, "Request ID is required.");
    }

    LOG.info("Step 1: Input validation passed");

    // 2. Fetch Request and Items
    let requestData, items;

    if (USE_HARDCODED_PAYLOAD) {
      LOG.info("Step 2: Using hardcoded test payload");
      const testData = getHardcodedTestData();
      requestData = testData.request;
      items = testData.items;
    } else {
      LOG.info("Step 2: Fetching from database");
      const tx = cds.tx(request);
      const result = await fetchRequestWithItems(params.requestId, tx);
      requestData = result.request;
      items = result.items;
    }

    if (!items || items.length === 0) {
      LOG.warn("No items found for request:", params.requestId);
      return request.error(400, "Request has no items to post.");
    }

    LOG.info("Step 2: Items fetched, count:", items.length);

    // 3. Build S/4 RFC payload
    const overrides = {
      testMode: params.testMode ?? DEFAULT_HEADER_VALUES.TEST_MODE,
    };
    const s4Payload = buildS4Payload(requestData, items, overrides);

    LOG.info(
      "Step 3: Payload built with",
      s4Payload.IT_ITEM.length,
      "line items",
    );

    // 4. Get CPI destination
    const cpiDest = await getCpiDestination();
    LOG.info("Step 4: CPI destination retrieved");

    // 5. POST to CPI
    const s4Response = await postDocumentToCpi(cpiDest, s4Payload);
    LOG.info("Step 5: CPI/S4 call completed");

    // 6. Parse the XML RFC response
    LOG.info("Step 6: Parsing XML response");
    const etReturn = await parseXmlResponse(s4Response);

    LOG.info("Step 6: Parsed ET_RETURN items:", JSON.stringify(etReturn));

    const parsedResponse = parseS4Response(etReturn);

    LOG.info("Step 6: RFC response parsed", {
      hasErrors: parsedResponse.hasErrors,
      messageCount: parsedResponse.messages.length,
      errorCount: parsedResponse.errors.length,
    });

    // 7. Return result
    const result = {
      success: !parsedResponse.hasErrors,
      messages: parsedResponse.messages,
      errors: parsedResponse.errors,
    };

    LOG.info("postToS4 action completed successfully");
    return result;
  } catch (error) {
    LOG.error("Error in postToS4:", error.message);
    return request.error(
      500,
      `Failed to post document to S/4. Error: ${error.message}`,
    );
  }
};