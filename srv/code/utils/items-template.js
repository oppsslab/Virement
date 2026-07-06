const XLSX = require("xlsx");

/**
 * RequestItems Excel template generator.
 *
 * Common columns for all templates:
 *   - srNo
 *   - costCentre
 *   - glAccount
 *   - material
 *   - wbs
 *   - assetStatus
 *   - description
 *
 * Conditional amount columns:
 *   - supplementAmount      : MASS_UPLOAD_ALL
 *   - returnAmount          : Return or MASS_UPLOAD_ALL
 *   - transferInAmount      : Transfer normal user, Transfer MASS_UPLOAD_TRANSFER, or MASS_UPLOAD_ALL
 *   - transferOutAmount     : Transfer MASS_UPLOAD_TRANSFER or MASS_UPLOAD_ALL
 */

const BASE_COLUMNS = [
  { key: "srNo", header: "SR No", example: "1", width: 10 },
  { key: "costCentre", header: "Cost Centre", example: "CC1000", width: 15 },
  { key: "glAccount", header: "GL Account", example: "400000", width: 15 },
  { key: "material", header: "Material", example: "MAT-001", width: 15 },
  { key: "wbs", header: "WBS", example: "WBS-001", width: 15 },
  {
    key: "assetStatus",
    header: "Asset Status",
    example: "N",
    width: 18,
  },
];

const SUPPLEMENT_AMOUNT_COLUMN = {
  key: "supplementAmount",
  header: "Supplement Amount",
  example: "2000.00",
  width: 18,
};

const RETURN_AMOUNT_COLUMN = {
  key: "returnAmount",
  header: "Return Amount",
  example: "1000.00",
  width: 18,
};

const TRANSFER_IN_AMOUNT_COLUMN = {
  key: "transferInAmount",
  header: "Transfer In Amount",
  example: "5000.00",
  width: 20,
};

const TRANSFER_OUT_AMOUNT_COLUMN = {
  key: "transferOutAmount",
  header: "Transfer Out Amount",
  example: "3000.00",
  width: 20,
};

const DESCRIPTION_COLUMN = {
  key: "description",
  header: "Description",
  example: "Example item",
  width: 25,
};

function normalizeRequestType(requestType) {
  return String(requestType || "").trim().toUpperCase();
}

function normalizeRoles(userRoles) {
  if (!Array.isArray(userRoles)) {
    return [];
  }

  return userRoles.map(function (role) {
    return String(role || "").trim().toUpperCase();
  });
}

function getTemplateDefinition(userRoles, requestType) {
  const roles = normalizeRoles(userRoles);
  const type = normalizeRequestType(requestType);

  const isJKEW = roles.includes("MASS_UPLOAD_ALL");
  const isFunctional = roles.includes("MASS_UPLOAD_TRANSFER");

  const columns = BASE_COLUMNS.slice();

  /*
   * MASS_UPLOAD_ALL:
   * Gets all amount columns regardless of request type.
   */
  if (isJKEW) {
    columns.push(SUPPLEMENT_AMOUNT_COLUMN);
    columns.push(RETURN_AMOUNT_COLUMN);
    columns.push(TRANSFER_IN_AMOUNT_COLUMN);
    columns.push(TRANSFER_OUT_AMOUNT_COLUMN);
    columns.push(DESCRIPTION_COLUMN);

    return {
      templateName: "JKEW",
      columns: columns,
    };
  }

  /*
   * Return:
   * Gets returnAmount.
   */
  if (type === "R") {
    columns.push(RETURN_AMOUNT_COLUMN);
    columns.push(DESCRIPTION_COLUMN);

    return {
      templateName: "Return",
      columns: columns,
    };
  }

  /*
   * Transfer + MASS_UPLOAD_TRANSFER:
   * Gets transferInAmount and transferOutAmount.
   */
  if (type === "T" && isFunctional) {
    columns.push(TRANSFER_IN_AMOUNT_COLUMN);
    columns.push(TRANSFER_OUT_AMOUNT_COLUMN);
    columns.push(DESCRIPTION_COLUMN);

    return {
      templateName: "Transfer_Functional",
      columns: columns,
    };
  }

  /*
   * Transfer + normal user:
   * Gets transferInAmount only.
   */
  if (type === "T") {
    columns.push(TRANSFER_IN_AMOUNT_COLUMN);
    columns.push(DESCRIPTION_COLUMN);

    return {
      templateName: "Transfer",
      columns: columns,
    };
  }

  /*
   * Supplement and other request types are not supported
   * unless user is MASS_UPLOAD_ALL, which was already handled above.
   */
  throw new Error(
    "Mass upload template is only available for Return and Transfer requests."
  );
}

function getTemplateColumns(userRoles, requestType) {
  return getTemplateDefinition(userRoles, requestType).columns;
}

function buildTemplate(userRoles, requestType) {
  const templateDefinition = getTemplateDefinition(userRoles, requestType);
  const columns = templateDefinition.columns;

  const headerRow = columns.map(function (column) {
    return column.header;
  });

  const exampleRow = columns.map(function (column) {
    return column.example;
  });

  const worksheet = XLSX.utils.aoa_to_sheet([headerRow, exampleRow]);

  worksheet["!cols"] = columns.map(function (column) {
    return {
      wch: column.width || 24,
    };
  });

  /*
   * Note:
   * The standard xlsx package may not preserve styles in all versions.
   * The file will still generate correctly even if styling is ignored.
   */
  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFFFF" } },
    fill: { patternType: "solid", fgColor: { rgb: "FF4472C4" } },
    alignment: { horizontal: "center", vertical: "center" },
  };

  for (let i = 0; i < headerRow.length; i++) {
    const cellRef = XLSX.utils.encode_col(i) + "1";

    if (!worksheet[cellRef]) {
      worksheet[cellRef] = {};
    }

    worksheet[cellRef].s = headerStyle;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "RequestItems");

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  return {
    fileName:
      "Mass_Upload_Template_" + templateDefinition.templateName + ".xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

function getColumnKeys(userRoles, requestType) {
  const columns = getTemplateColumns(userRoles, requestType);

  return columns.map(function (column) {
    return column.key;
  });
}

module.exports = {
  BASE_COLUMNS,
  SUPPLEMENT_AMOUNT_COLUMN,
  RETURN_AMOUNT_COLUMN,
  TRANSFER_IN_AMOUNT_COLUMN,
  TRANSFER_OUT_AMOUNT_COLUMN,
  DESCRIPTION_COLUMN,
  getTemplateColumns,
  buildTemplate,
  getColumnKeys,
};