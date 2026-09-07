const XLSX = require("xlsx");

/*
 * Columns for the GL Grouping mass-upload template. The header text
 * here must stay in sync with the header text expected by
 * upload-gl-grouping-logic.js.
 */
const TEMPLATE_COLUMNS = [
  {
    key: "expenditureGroup",
    header: "Expenditure Group",
    example: "Belanja Kakitangan",
    width: 30,
  },
  {
    key: "glGroup",
    header: "GL Group",
    example: "Gaji",
    width: 26,
  },
  {
    key: "glAccount",
    header: "GL Account",
    example: "710000",
    width: 16,
  },
  {
    key: "glAccountDescription",
    header: "GL Account Description",
    example: "Personel Emolumen",
    width: 32,
  },
  {
    key: "assetType",
    header: "Asset Type",
    example: "NON ASSET",
    width: 14,
  },
  {
    key: "functional",
    header: "Functional",
    example: "",
    width: 14,
  },
];

/**
 * Builds the GL Grouping mass-upload template as an in-memory XLSX
 * workbook.
 *
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
function buildGLGroupingTemplate() {
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
  XLSX.utils.book_append_sheet(workbook, worksheet, "GLGrouping");

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  return {
    fileName: "GL_Grouping_Template.xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

module.exports = { buildGLGroupingTemplate, TEMPLATE_COLUMNS };
