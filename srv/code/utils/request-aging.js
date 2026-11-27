"use strict";

const cds = require("@sap/cds");

const { calculateDaysSince } = require("./date-utils");

const { REQUEST_STATUS } = require("./request-status");

const REQUESTS_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.Requests";

const REQUEST_APPROVERS_DATABASE_ENTITY = "ZDB_PPS_VIREMENT.RequestApprovers";

/*
 * Statuses after which a request no longer moves, so its aging stops.
 */
const FINAL_STATUS_CODES = [
  REQUEST_STATUS.REJECTED,
  REQUEST_STATUS.APPROVED,
  REQUEST_STATUS.POSTED,
];

/**
 * Loads submissionDate and status from the active Requests table.
 *
 * A draft row shares its ID with the active record it edits, so the
 * active record is the authority on when the request was submitted
 * (and how it ended) whenever the draft copy does not carry it.
 *
 * @param {string[]} ids
 * @returns {Promise<Map<string, {submissionDate: string, status_code: number}>>}
 */
async function loadRequestInfo(ids) {
  if (!ids.length) {
    return new Map();
  }

  const rows = await cds.db.run(
    SELECT.from(REQUESTS_DATABASE_ENTITY)
      .columns("ID", "submissionDate", "status_code")
      .where({
        ID: {
          in: ids,
        },
      }),
  );

  return new Map(rows.map((row) => [row.ID, row]));
}

/**
 * Loads the date each request reached its final status: the latest
 * action date of its approvers (set when an approver approves or
 * rejects, and by Reject by System).
 *
 * @param {string[]} ids - requests already in a final status
 * @returns {Promise<Map<string, string>>}
 */
async function loadCompletionDates(ids) {
  if (!ids.length) {
    return new Map();
  }

  const rows = await cds.db.run(
    SELECT.from(REQUEST_APPROVERS_DATABASE_ENTITY)
      .columns("request_ID", "actionDate")
      .where({
        request_ID: {
          in: ids,
        },
        actionDate: {
          "!=": null,
        },
      }),
  );

  const latest = new Map();

  for (const row of rows) {
    const current = latest.get(row.request_ID);

    if (!current || new Date(row.actionDate) > new Date(current)) {
      latest.set(row.request_ID, row.actionDate);
    }
  }

  return latest;
}

/**
 * Sets aging on every row to the number of calendar days since the
 * request was submitted. Once a request is Completed or Rejected the
 * count stops at the day it finished instead of running to today.
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
   * Submission date and status are loaded from the active record
   * when the UI's $select omitted them, and on draft rows copied
   * before the request was submitted.
   */
  const idsToLoad = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.ID &&
            (!row.submissionDate ||
              row.status_code === undefined ||
              row.status_code === null),
        )
        .map((row) => row.ID),
    ),
  ];

  const infoById = await loadRequestInfo(idsToLoad);

  const finalIds = [
    ...new Set(
      rows
        .filter((row) => {
          const status =
            row.status_code ?? infoById.get(row.ID)?.status_code ?? null;

          return row.ID && FINAL_STATUS_CODES.includes(status);
        })
        .map((row) => row.ID),
    ),
  ];

  const completionDatesById = await loadCompletionDates(finalIds);

  for (const row of rows) {
    const info = infoById.get(row.ID);

    const submissionDate = row.submissionDate || info?.submissionDate || null;

    const endDate = completionDatesById.get(row.ID) || new Date();

    row.aging = calculateDaysSince(submissionDate, endDate);
  }
}

module.exports = {
  applyAgingToRows,
};
