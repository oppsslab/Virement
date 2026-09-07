const XLSX = require("xlsx");

/*
 * Columns for the Building Grouping mass-upload template. The header
 * text here must stay in sync with the header text expected by
 * upload-building-grouping-logic.js.
 */
const TEMPLATE_COLUMNS = [
  {
    key: "state",
    header: "State",
    example: "JOHOR",
    width: 24,
  },
  {
    key: "costCentre",
    header: "Cost Centre",
    example: "10112B001",
    width: 16,
  },
  {
    key: "costCentreDescription",
    header: "Cost Centre Description",
    example: "Bangunan KWSP Johor Bahru",
    width: 36,
  },
];

/**
 * Builds the Building Grouping mass-upload template as an in-memory
 * XLSX workbook.
 *
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
function buildBuildingGroupingTemplate() {
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
  XLSX.utils.book_append_sheet(workbook, worksheet, "BuildingGrouping");

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  return {
    fileName: "Building_Grouping_Template.xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

module.exports = {
  buildBuildingGroupingTemplate,
  TEMPLATE_COLUMNS,
};
