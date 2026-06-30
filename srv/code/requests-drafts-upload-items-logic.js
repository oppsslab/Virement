const cds = require("@sap/cds");
const XLSX = require("xlsx");
const { TEMPLATE_COLUMNS } = require("./utils/items-template");

const LOG = cds.log("requests-drafts-upload-items-logic");
const VALID_ASSET_STATUS = ["N", "A", "R"];
const VALID_ITEM_TYPE = ["S", "R", "I", "O"];
const MAX_ERRORS_SHOWN = 20;
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;
const SR_NO_PAD_LENGTH = 3;

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildHeaderMap() {
  const map = {};
  for (const col of TEMPLATE_COLUMNS)
    map[normalizeHeader(col.header)] = col.key;
  return map;
}

function parseExcel(base64Content) {
  const workbook = XLSX.read(base64Content, { type: "base64" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  if (!rows || rows.length < 2) return [];

  const headerMap = buildHeaderMap();
  const headerRow = rows[0].map((h) => normalizeHeader(h));
  const colToField = headerRow.map((h) => headerMap[h] || null);
  const parsed = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const isEmpty = row.every(
      (cell) => cell === "" || cell === null || cell === undefined,
    );
    if (isEmpty) continue;

    const obj = {};
    row.forEach((cell, idx) => {
      const field = colToField[idx];
      if (field) obj[field] = typeof cell === "string" ? cell.trim() : cell;
    });
    obj.__rowNumber = i + 1;
    parsed.push(obj);
  }
  return parsed;
}

function validateRow(row) {
  const errors = [];
  const rowNo = row.__rowNumber;

  let amount = row.amount;
  if (amount === "" || amount === null || amount === undefined) {
    errors.push({
      row: rowNo,
      field: "amount",
      message: `Row ${rowNo}: Amount is required.`,
    });
    amount = null;
  } else {
    amount = Number(amount);
    if (Number.isNaN(amount)) {
      errors.push({
        row: rowNo,
        field: "amount",
        message: `Row ${rowNo}: Amount "${row.amount}" is not a number.`,
      });
      amount = null;
    } else if (amount <= 0) {
      errors.push({
        row: rowNo,
        field: "amount",
        message: `Row ${rowNo}: Amount must be greater than zero.`,
      });
    }
  }

  const type = row.type_code
    ? String(row.type_code).trim().toUpperCase()
    : null;
  if (!type) {
    errors.push({
      row: rowNo,
      field: "type_code",
      message: `Row ${rowNo}: Type is required.`,
    });
  } else if (!VALID_ITEM_TYPE.includes(type)) {
    errors.push({
      row: rowNo,
      field: "type_code",
      message: `Row ${rowNo}: Type "${type}" is invalid (allowed: S/R/I/O).`,
    });
  }

  const assetStatus = row.assetStatus_code
    ? String(row.assetStatus_code).trim().toUpperCase()
    : null;
  if (assetStatus && !VALID_ASSET_STATUS.includes(assetStatus)) {
    errors.push({
      row: rowNo,
      field: "assetStatus_code",
      message: `Row ${rowNo}: Asset Status "${assetStatus}" is invalid (allowed: N/A/R).`,
    });
  }

  const description = row.description ? String(row.description).trim() : null;
  if (description && description.length > 255) {
    errors.push({
      row: rowNo,
      field: "description",
      message: `Row ${rowNo}: Description exceeds 255 characters.`,
    });
  }

  if (errors.length) return { item: null, errors };

  return {
    item: {
      srNo: row.srNo ? String(row.srNo).trim() : null,
      costCentre: row.costCentre ? String(row.costCentre).trim() : null,
      glAccount: row.glAccount ? String(row.glAccount).trim() : null,
      material: row.material ? String(row.material).trim() : null,
      wbs: row.wbs ? String(row.wbs).trim() : null,
      assetStatus_code: assetStatus,
      type_code: type,
      amount,
      description,
    },
    errors: [],
  };
}

function isActiveEntity(request) {
  const params = request.params || [];
  const last = params[params.length - 1] || {};
  return last.IsActiveEntity === true || last.IsActiveEntity === "true";
}

function reportValidationErrors(request, allErrors) {
  const shown = allErrors.slice(0, MAX_ERRORS_SHOWN);
  const remaining = allErrors.length - shown.length;

  for (const err of shown) {
    request.error(400, err.message, `items/${err.row}/${err.field}`);
  }

  if (remaining > 0) {
    request.error(
      400,
      `There are ${remaining} more validation error(s). Please correct the upload file and try again.`,
      "items",
    );
  }

  // Important: do not request.reject("Upload validation failed.") here.
  // Returning after request.error(...) lets CAP reject with collected details.
  return;
}

module.exports = async function uploadItems(request) {
  LOG.info("--- ON uploadItems started ---");
  try {
    const { content } = request.data;

    if (!content) return request.error(400, "No file content was provided.");
    if (content.length > MAX_BASE64_LENGTH)
      return request.error(
        400,
        "The uploaded file is too large. Please reduce the number of rows.",
      );
    if (isActiveEntity(request))
      return request.error(
        400,
        "Items can only be uploaded while editing the request.",
      );

    let rows;
    try {
      rows = parseExcel(content);
    } catch (parseError) {
      LOG.error("Excel parsing failed:", parseError);
      return request.error(
        400,
        "Could not read the Excel file. Please use the provided template.",
      );
    }

    if (rows.length === 0)
      return request.error(
        400,
        "The uploaded file contains no data rows. Please fill in the template and try again.",
      );

    LOG.info(`Parsed ${rows.length} data row(s) from upload.`);
    const validItems = [];
    const allErrors = [];

    for (const row of rows) {
      const { item, errors } = validateRow(row);
      if (errors.length) allErrors.push(...errors);
      else validItems.push(item);
    }

    if (allErrors.length) {
      LOG.warn(`Validation failed with ${allErrors.length} error(s).`);
      return reportValidationErrors(request, allErrors);
    }

    let nextSr = 1;
    for (const item of validItems) {
      if (!item.srNo)
        item.srNo = String(nextSr).padStart(SR_NO_PAD_LENGTH, "0");
      nextSr++;
    }

    LOG.info(`Returning ${validItems.length} validated item(s) to the UI.`);
    LOG.info("--- ON uploadItems ended successfully ---");
    return { items: validItems };
  } catch (error) {
    if (
      error &&
      (error.status === 400 ||
        error.statusCode === 400 ||
        error.code === 400 ||
        error.code === "400")
    )
      throw error;
    LOG.error("uploadItems failed unexpectedly:", error);
    return request.error(500, "Failed to process the uploaded file.");
  }
};