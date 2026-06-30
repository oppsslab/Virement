const XLSX = require("xlsx");

/**
 * Shared column definitions for the RequestItems Excel template.
 *
 * SINGLE SOURCE OF TRUTH used by BOTH:
 *   - downloadItemsTemplate  (via buildTemplate)
 *   - uploadItems            (imports TEMPLATE_COLUMNS to map columns)
 *
 * `header` : visible Excel column title (the up/download contract)
 * `key`    : corresponding RequestItems field name
 * `example`: sample value shown in the guidance row
 */
const TEMPLATE_COLUMNS = [
  { key: "srNo", header: "SR No", example: "1" },
  { key: "costCentre", header: "Cost Centre", example: "CC1000" },
  { key: "glAccount", header: "GL", example: "400000" },
  { key: "material", header: "Material", example: "MAT-001" },
  { key: "wbs", header: "WBS", example: "WBS-001" },
  { key: "assetStatus_code", header: "Asset Status (N/A/R)", example: "N" },
  { key: "type_code", header: "Type (S/R/I/O)", example: "S" },
  { key: "amount", header: "Amount", example: "1000.00" },
  {
    key: "description",
    header: "Description",
    example: "Example item - delete this row",
  },
];

/**
 * Builds an empty Excel template (header row + one example row)
 * and returns it as a base64-encoded string.
 *
 * @returns {{ fileName: string, content: string, mimeType: string }}
 */
function buildTemplate() {
  const headerRow = TEMPLATE_COLUMNS.map((c) => c.header);
  const exampleRow = TEMPLATE_COLUMNS.map((c) => c.example);

  const worksheet = XLSX.utils.aoa_to_sheet([headerRow, exampleRow]);
  worksheet["!cols"] = TEMPLATE_COLUMNS.map(() => ({ wch: 24 }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "RequestItems");

  const base64 = XLSX.write(workbook, { type: "base64", bookType: "xlsx" });

  return {
    fileName: "Mass Upload Template.xlsx",
    content: base64,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

module.exports = { TEMPLATE_COLUMNS, buildTemplate };
