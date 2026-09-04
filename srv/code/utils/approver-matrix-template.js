const XLSX = require("xlsx");

/*
 * Columns for the Approver Matrix mass-upload template. The header
 * text here must stay in sync with the header text expected by
 * upload-approver-matrix-logic.js.
 */
const TEMPLATE_COLUMNS = [
  {
    key: "userRoleName",
    header: "User Role Name",
    example: "Head of Department",
    width: 32,
  },
  {
    key: "departmentBranch",
    header: "Department/Branch/etc",
    example: "Finance",
    width: 26,
  },
  {
    key: "emailAddress",
    header: "Email Address",
    example: "jane.doe@pwc.com",
    width: 28,
  },
  { key: "name", header: "Name", example: "Jane Doe", width: 24 },
  { key: "isActive", header: "Active?", example: "Y", width: 10 },
  {
    key: "startDate",
    header: "Start Date",
    example: "2026-01-01",
    width: 14,
  },
  { key: "endDate", header: "End Date", example: "", width: 14 },
];

/**
 * Builds the Approver Matrix mass-upload template as an in-memory
 * XLSX workbook.
 *
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
function buildApproverMatrixTemplate() {
  const headerRow = TEMPLATE_COLUMNS.map((column) => column.header);
  const exampleRow = TEMPLATE_COLUMNS.map((column) => column.example);

  const worksheet = XLSX.utils.aoa_to_sheet([headerRow, exampleRow]);

  worksheet["!cols"] = TEMPLATE_COLUMNS.map((column) => ({
    wch: column.width || 24,
  }));

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
  XLSX.utils.book_append_sheet(workbook, worksheet, "ApproverMatrix");

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  return {
    fileName: "Approver_Matrix_Template.xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

module.exports = { buildApproverMatrixTemplate, TEMPLATE_COLUMNS };
