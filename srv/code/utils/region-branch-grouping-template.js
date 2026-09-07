const XLSX = require("xlsx");

/*
 * Columns for the Region & Branch Grouping mass-upload template. The
 * header text here must stay in sync with the header text expected
 * by upload-region-branch-grouping-logic.js.
 */
const TEMPLATE_COLUMNS = [
  {
    key: "region",
    header: "Region",
    example: "PEJABAT PENGARAH WILAYAH SABAH",
    width: 36,
  },
  {
    key: "state",
    header: "State",
    example: "KWSP NEGERI SABAH",
    width: 24,
  },
  {
    key: "branch",
    header: "Branch",
    example: "KWSP Kota Kinabalu",
    width: 30,
  },
  {
    key: "costCentre",
    header: "Cost Centre",
    example: "112SP3000",
    width: 16,
  },
  {
    key: "costCentreDescription",
    header: "Cost Centre Description",
    example: "KWSP Kota Kinabalu",
    width: 36,
  },
];

/**
 * Builds the Region & Branch Grouping mass-upload template as an
 * in-memory XLSX workbook.
 *
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
function buildRegionBranchGroupingTemplate() {
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
  XLSX.utils.book_append_sheet(workbook, worksheet, "RegionBranchGrouping");

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  return {
    fileName: "Region_Branch_Grouping_Template.xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

module.exports = {
  buildRegionBranchGroupingTemplate,
  TEMPLATE_COLUMNS,
};
