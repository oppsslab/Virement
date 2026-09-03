"use strict";

const cds = require("@sap/cds");

const { calculateDaysSince } = require("./date-utils");

const REQUESTS_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.Requests";

/**
 * Loads submissionDate from the active Requests table.
 *
 * A draft row shares its ID with the active record it edits, so the
 * active record is the authority on when the request was submitted
 * whenever the draft copy does not carry the date itself.
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>}
 */
async function loadSubmissionDates(ids) {
  if (!ids.length) {
    return new Map();
  }

  const rows = await cds.db.run(
    SELECT.from(REQUESTS_DATABASE_ENTITY)
      .columns("ID", "submissionDate")
      .where({
        ID: {
          in: ids,
        },
      }),
  );

  return new Map(rows.map((row) => [row.ID, row.submissionDate]));
}

/**
 * Sets aging on every row to the number of calendar days since the
 * request was submitted.
 *
 * Computed on read rather than stored: the persisted aging column is
 * never written, so any read path that skips this leaves it at its
 * database default of 0. Both read paths must call it, because Fiori
 * Elements serves the list from Requests or from Requests.drafts
 * depending on the filter it sends.
 *
 * An unsubmitted request has no submission date and ages zero days.
 *
 * @param {object|object[]} results
 */
async function applyAgingToRows(results) {
  const rows = (Array.isArray(results) ? results : [results]).filter(Boolean);

  if (!rows.length) {
    return;
  }

  /*
   * The date is missing when the UI's $select omitted it, and on
   * draft rows copied before the request was submitted.
   */
  const idsToLoad = [
    ...new Set(
      rows.filter((row) => row.ID && !row.submissionDate).map((row) => row.ID),
    ),
  ];

  const submissionDatesById = await loadSubmissionDates(idsToLoad);

  for (const row of rows) {
    const submissionDate =
      row.submissionDate || submissionDatesById.get(row.ID) || null;

    row.aging = calculateDaysSince(submissionDate);
  }
}

module.exports = {
  applyAgingToRows,
};
