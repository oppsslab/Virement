"use strict";

const cds = require("@sap/cds");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/*
 * The source data's GL Accounts column mixes several separators
 * within one cell (newlines, commas, slashes, ampersands - e.g.
 * "110900 / 110902" or "710029 & 710030"), so a GL Account is matched
 * as a whole token after splitting on any of them, never as a
 * substring (avoids "710029" wrongly matching inside "7100290").
 */
const GL_ACCOUNT_LIST_SEPARATOR = /[\n,/&]+/;

/**
 * Looks up the Functional Department for a GL Account from the
 * Functional Department Grouping master data (see db/schema.cds
 * FunctionalDepartmentGrouping entity), for the read-only Functional
 * Department display field on RequestItems (Virement item tables).
 *
 * Each row lists its GL Accounts as a single delimited text field
 * rather than one row per account, so this reads every row (a small,
 * hand-maintained table) and checks whether glAccount appears as one
 * of its listed tokens.
 *
 * @param {object} tx - an active cds.tx()
 * @param {string} glAccount
 * @returns {Promise<string|null>}
 */
async function resolveFunctionalDepartment(tx, glAccount) {
  const trimmed = String(glAccount || "").trim();

  if (!trimmed) {
    return null;
  }

  const { FunctionalDepartmentGrouping } = cds.entities(SERVICE_NAMESPACE);

  const rows = await tx.run(
    SELECT.from(FunctionalDepartmentGrouping).columns(
      "functionalDepartment",
      "glAccounts",
    ),
  );

  for (const row of rows) {
    const tokens = String(row.glAccounts || "")
      .split(GL_ACCOUNT_LIST_SEPARATOR)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.includes(trimmed)) {
      return row.functionalDepartment;
    }
  }

  return null;
}

module.exports = { resolveFunctionalDepartment };
