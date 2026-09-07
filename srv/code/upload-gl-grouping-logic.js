"use strict";

const cds = require("@sap/cds");
const XLSX = require("xlsx");

const { TEMPLATE_COLUMNS } = require("./utils/gl-grouping-template");

const LOG = cds.log("upload-gl-grouping-logic");

const MAX_ERRORS_SHOWN = 20;
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildHeaderMap() {
  const map = {};

  for (const col of TEMPLATE_COLUMNS) {
    map[normalizeHeader(col.header)] = col.key;
  }

  return map;
}

/**
 * Parses an uploaded workbook into row objects keyed by template
 * column.
 *
 * @param {string} base64Content
 * @returns {object[]}
 */
function parseExcel(base64Content) {
  const workbook = XLSX.read(base64Content, {
    type: "base64",
    cellDates: true,
  });

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    return [];
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (!rows || rows.length < 2) {
    return [];
  }

  const headerMap = buildHeaderMap();
  const headerRow = rows[0].map((header) => normalizeHeader(header));
  const colToField = headerRow.map((header) => headerMap[header] || null);

  const parsed = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    const isEmpty = row.every(
      (cell) => cell === "" || cell === null || cell === undefined,
    );

    if (isEmpty) {
      continue;
    }

    const obj = {};

    row.forEach((cell, idx) => {
      const field = colToField[idx];

      if (field) {
        obj[field] = typeof cell === "string" ? cell.trim() : cell;
      }
    });

    obj.__rowNumber = i + 1;
    parsed.push(obj);
  }

  return parsed;
}

function toTrimmedString(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value).trim();
}

/**
 * Validates and normalizes one parsed row.
 *
 * @param {object} row
 * @returns {{item: object|null, errors: object[]}}
 */
function validateRow(row) {
  const errors = [];
  const rowNo = row.__rowNumber;

  const expenditureGroup = toTrimmedString(row.expenditureGroup);
  const glGroup = toTrimmedString(row.glGroup);
  const glAccount = toTrimmedString(row.glAccount);
  const glAccountDescription = toTrimmedString(row.glAccountDescription);
  const assetType = toTrimmedString(row.assetType);
  const functional = toTrimmedString(row.functional);

  if (!expenditureGroup) {
    errors.push({
      row: rowNo,
      field: "expenditureGroup",
      message: `Row ${rowNo}: Expenditure Group is required.`,
    });
  }

  if (!glGroup) {
    errors.push({
      row: rowNo,
      field: "glGroup",
      message: `Row ${rowNo}: GL Group is required.`,
    });
  }

  if (!glAccount) {
    errors.push({
      row: rowNo,
      field: "glAccount",
      message: `Row ${rowNo}: GL Account is required.`,
    });
  }

  if (errors.length) {
    return { item: null, errors };
  }

  return {
    item: {
      expenditureGroup,
      glGroup,
      glAccount,
      glAccountDescription,
      assetType,
      functional,
    },
    errors: [],
  };
}

function reportValidationErrors(request, allErrors) {
  const shown = allErrors.slice(0, MAX_ERRORS_SHOWN);
  const remaining = allErrors.length - shown.length;

  for (const err of shown) {
    request.error(400, err.message, `rows/${err.row}/${err.field}`);
  }

  if (remaining > 0) {
    request.error(
      400,
      `There are ${remaining} more validation error(s). Please correct the upload file and try again.`,
      "rows",
    );
  }
}

module.exports = async function uploadGLGrouping(request) {
  LOG.info("--- uploadGLGrouping started ---");

  try {
    const { content } = request.data;

    if (!content) {
      return request.error(400, "No file content was provided.");
    }

    if (content.length > MAX_BASE64_LENGTH) {
      return request.error(
        400,
        "The uploaded file is too large. Please reduce the number of rows.",
      );
    }

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

    if (!rows.length) {
      return request.error(
        400,
        "The uploaded file contains no data rows. Please fill in the template and try again.",
      );
    }

    LOG.info(`Parsed ${rows.length} data row(s) from upload.`);

    const validRows = [];
    const allErrors = [];

    for (const row of rows) {
      const { item, errors } = validateRow(row);

      if (errors.length) {
        allErrors.push(...errors);
      } else {
        validRows.push(item);
      }
    }

    if (allErrors.length) {
      LOG.warn(`Validation failed with ${allErrors.length} error(s).`);

      return reportValidationErrors(request, allErrors);
    }

    LOG.info(`Returning ${validRows.length} validated row(s) to the UI.`);

    return { rows: validRows };
  } catch (error) {
    if (
      error &&
      (error.status === 400 || error.statusCode === 400 || error.code === 400)
    ) {
      throw error;
    }

    LOG.error("uploadGLGrouping failed unexpectedly:", error);

    return request.error(500, "Failed to process the uploaded file.");
  }
};
