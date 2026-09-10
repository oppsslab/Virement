const XLSX = require("xlsx");

/*
 * Columns for the Functional Department Grouping mass-upload
 * template. The header text here must stay in sync with the header
 * text expected by upload-functional-department-grouping-logic.js.
 */
const TEMPLATE_COLUMNS = [
  {
    key: "functionalDepartment",
    header: "Functional Department",
    example: "Jabatan Pengurusan Perolehan & Bekalan (JPPB)",
    width: 40,
  },
  {
    key: "itemType",
    header: "Item Type",
    example: "Aset",
    width: 40,
  },
  {
    key: "glAccounts",
    header: "GL Accounts",
    example: "110600, 111002, 110800, 111000",
    width: 40,
  },
  {
    key: "isBuildingGrouping",
    header: "Building Grouping",
    example: "FALSE",
    width: 20,
  },
  {
    key: "isDepartment",
    header: "Department",
    example: "FALSE",
    width: 20,
  },
  {
    key: "isRegionAndBranch",
    header: "Region & Branch",
    example: "FALSE",
    width: 20,
  },
  {
    key: "remarks",
    header: "Remarks",
    example: "",
    width: 50,
  },
];

/**
 * Builds the Functional Department Grouping mass-upload template as
 * an in-memory XLSX workbook.
 *
 * @returns {{fileName: string, content: string, mimeType: string}}
 */
function buildFunctionalDepartmentGroupingTemplate() {
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
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    "FunctionalDepartmentGrouping",
  );

  const base64 = XLSX.write(workbook, {
    type: "base64",
    bookType: "xlsx",
  });

  return {
    fileName: "Functional_Department_Grouping_Template.xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

module.exports = {
  buildFunctionalDepartmentGroupingTemplate,
  TEMPLATE_COLUMNS,
};
