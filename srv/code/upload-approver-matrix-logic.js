"use strict";

const cds = require("@sap/cds");
const XLSX = require("xlsx");

const { TEMPLATE_COLUMNS } = require("./utils/approver-matrix-template");

const LOG = cds.log("upload-approver-matrix-logic");

const MAX_ERRORS_SHOWN = 20;
const MAX_BASE64_LENGTH = 10 * 1024 * 1024;

const TRUTHY_ACTIVE_VALUES = ["Y", "YES", "TRUE", "1", "ACTIVE"];
const FALSY_ACTIVE_VALUES = ["N", "NO", "FALSE", "0", "INACTIVE"];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * column, tolerating real Excel dates (read as JS Date objects) as
 * well as plain typed-in date strings.
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
 * Normalizes a date cell (a Date object from an Excel date cell, or a
 * typed-in "YYYY-MM-DD" string) into a "YYYY-MM-DD" string.
 *
 * @param {*} value
 * @returns {string|null}
 */
function parseDateCell(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return undefined;
}

function parseActiveCell(value) {
  if (value === null || value === undefined || value === "") {
    return true;
  }

  const text = String(value).trim().toUpperCase();

  if (TRUTHY_ACTIVE_VALUES.includes(text)) {
    return true;
  }

  if (FALSY_ACTIVE_VALUES.includes(text)) {
    return false;
  }

  return undefined;
}

/**
 * Validates and normalizes one parsed row.
 *
 * @param {object} row
 * @param {Map<string,string>} roleNameToCode - role display name
 *   (uppercased) to UserRoles.code
 * @returns {{item: object|null, errors: object[]}}
 */
function validateRow(row, roleNameToCode) {
  const errors = [];
  const rowNo = row.__rowNumber;

  const userRoleName = toTrimmedString(row.userRoleName);
  const emailAddress = toTrimmedString(row.emailAddress);
  const name = toTrimmedString(row.name);
  const departmentBranch = toTrimmedString(row.departmentBranch);

  let userRoleCode = null;

  if (!userRoleName) {
    errors.push({
      row: rowNo,
      field: "userRoleName",
      message: `Row ${rowNo}: User Role Name is required.`,
    });
  } else {
    userRoleCode = roleNameToCode.get(userRoleName.toUpperCase());

    if (!userRoleCode) {
      errors.push({
        row: rowNo,
        field: "userRoleName",
        message: `Row ${rowNo}: "${userRoleName}" is not a recognized User Role Name.`,
      });
    }
  }

  if (!emailAddress) {
    errors.push({
      row: rowNo,
      field: "emailAddress",
      message: `Row ${rowNo}: Email Address is required.`,
    });
  } else if (!EMAIL_PATTERN.test(emailAddress)) {
    errors.push({
      row: rowNo,
      field: "emailAddress",
      message: `Row ${rowNo}: "${emailAddress}" is not a valid email address.`,
    });
  }

  if (!name) {
    errors.push({
      row: rowNo,
      field: "name",
      message: `Row ${rowNo}: Name is required.`,
    });
  }

  const isActive = parseActiveCell(row.isActive);

  if (isActive === undefined) {
    errors.push({
      row: rowNo,
      field: "isActive",
      message: `Row ${rowNo}: Active? "${row.isActive}" must be Y or N.`,
    });
  }

  const startDate = parseDateCell(row.startDate);

  if (startDate === undefined) {
    errors.push({
      row: rowNo,
      field: "startDate",
      message: `Row ${rowNo}: Start Date "${row.startDate}" is not a valid date.`,
    });
  }

  const endDate = parseDateCell(row.endDate);

  if (endDate === undefined) {
    errors.push({
      row: rowNo,
      field: "endDate",
      message: `Row ${rowNo}: End Date "${row.endDate}" is not a valid date.`,
    });
  }

  if (
    startDate &&
    endDate &&
    startDate !== undefined &&
    endDate !== undefined &&
    endDate < startDate
  ) {
    errors.push({
      row: rowNo,
      field: "endDate",
      message: `Row ${rowNo}: End Date cannot be before Start Date.`,
    });
  }

  if (errors.length) {
    return { item: null, errors };
  }

  return {
    item: {
      userRole_code: userRoleCode,
      departmentBranch,
      emailAddress,
      name,
      isActive,
      startDate: startDate || null,
      endDate: endDate || null,
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

module.exports = async function uploadApproverMatrix(request) {
  LOG.info("--- uploadApproverMatrix started ---");

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

    const tx = cds.tx(request);
    const { UserRoles } = cds.entities("ZSVC_PPS_VIREMENT");

    const roles = await tx.run(SELECT.from(UserRoles).columns("code", "descr"));

    const roleNameToCode = new Map();

    for (const role of roles) {
      roleNameToCode.set(
        String(role.descr || role.code || "")
          .trim()
          .toUpperCase(),
        role.code,
      );
    }

    const validRows = [];
    const allErrors = [];

    for (const row of rows) {
      const { item, errors } = validateRow(row, roleNameToCode);

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

    LOG.error("uploadApproverMatrix failed unexpectedly:", error);

    return request.error(500, "Failed to process the uploaded file.");
  }
};
