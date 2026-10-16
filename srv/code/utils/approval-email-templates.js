"use strict";

/**
 * Builds the two item tables used by the approval notification emails
 * (To Approver, Approved) - the one part of an EmailConfiguration
 * row's HTML that stays system-generated even though admins can
 * otherwise edit the full raw HTML, since per-row item data can't be
 * expressed as a simple {{Token}} placeholder. See
 * email-config-renderer.js, which substitutes a {{ItemsTable}} token
 * in the admin-edited subject/body with one of these.
 *
 * The Rejected email has no item table, so nothing is built for it
 * here.
 */

const TABLE_STYLE = "border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px;";
const CELL_STYLE = "border:1px solid #ccc;padding:4px;";
const HEADER_CELL_STYLE = `${CELL_STYLE}background:#f2f2f2;`;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatAmount(value) {
  const amount = Number(value) || 0;

  return amount.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/*
 * The grouping text shown per item ("Lokasi") - Department Grouping
 * master data resolved for that item's Cost Centre (see
 * db/schema.cds RequestItems.department). Blank when not set.
 */
function resolveItemLocation(item) {
  return item.department || "";
}

/* ------------------------------------------------------------------ *
 * To Approver items table
 * ------------------------------------------------------------------ */

function buildToApproverItemsTable(items) {
  let totalReduction = 0;
  let totalAddition = 0;

  const rows = (items || [])
    .map((item, index) => {
      const reduction =
        Number(item.transferOutAmount) || Number(item.returnAmount) || 0;
      const addition =
        Number(item.transferInAmount) || Number(item.supplementAmount) || 0;

      totalReduction += reduction;
      totalAddition += addition;

      return `
      <tr>
        <td style="${CELL_STYLE}text-align:center;">${index + 1}.</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.costCentre)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.glAccount)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.material)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.description)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(resolveItemLocation(item))}</td>
        <td style="${CELL_STYLE}text-align:right;">${reduction ? formatAmount(reduction) : ""}</td>
        <td style="${CELL_STYLE}text-align:right;">${addition ? formatAmount(addition) : ""}</td>
      </tr>`;
    })
    .join("");

  return `
    <table style="${TABLE_STYLE}">
      <thead>
        <tr>
          <th style="${HEADER_CELL_STYLE}">No</th>
          <th style="${HEADER_CELL_STYLE}">Kod Pusat Kos</th>
          <th style="${HEADER_CELL_STYLE}">Kod GL</th>
          <th style="${HEADER_CELL_STYLE}">Kod Material</th>
          <th style="${HEADER_CELL_STYLE}">Item</th>
          <th style="${HEADER_CELL_STYLE}">Lokasi</th>
          <th style="${HEADER_CELL_STYLE}">Pengurangan</th>
          <th style="${HEADER_CELL_STYLE}">Pertambahan</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="6" style="${CELL_STYLE}font-weight:bold;text-align:right;">Jumlah</td>
          <td style="${CELL_STYLE}font-weight:bold;text-align:right;">${formatAmount(totalReduction)}</td>
          <td style="${CELL_STYLE}font-weight:bold;text-align:right;">${formatAmount(totalAddition)}</td>
        </tr>
      </tbody>
    </table>`;
}

/* ------------------------------------------------------------------ *
 * Approved items table
 * ------------------------------------------------------------------ */

function buildApprovedItemsTable(items, { documentNumber }) {
  const rows = (items || [])
    .map((item) => {
      const amount =
        Number(item.transferOutAmount) ||
        Number(item.transferInAmount) ||
        Number(item.returnAmount) ||
        Number(item.supplementAmount) ||
        0;

      return `
      <tr>
        <td style="${CELL_STYLE}">${escapeHtml(documentNumber)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.costCentre)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.glAccount)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.material)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.description)}</td>
        <td style="${CELL_STYLE}text-align:right;">${formatAmount(amount)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.assetStatus_code)}</td>
        <td style="${CELL_STYLE}">${escapeHtml(item.description)}</td>
      </tr>`;
    })
    .join("");

  return `
    <table style="${TABLE_STYLE}">
      <thead>
        <tr>
          <th style="${HEADER_CELL_STYLE}">No Dokumen</th>
          <th style="${HEADER_CELL_STYLE}">Pusat Kos</th>
          <th style="${HEADER_CELL_STYLE}">Kod GL</th>
          <th style="${HEADER_CELL_STYLE}">Kod Material</th>
          <th style="${HEADER_CELL_STYLE}">Item</th>
          <th style="${HEADER_CELL_STYLE}">Jumlah (RM)</th>
          <th style="${HEADER_CELL_STYLE}">Aset Status</th>
          <th style="${HEADER_CELL_STYLE}">Deskripsi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

module.exports = {
  buildToApproverItemsTable,
  buildApprovedItemsTable,
};
