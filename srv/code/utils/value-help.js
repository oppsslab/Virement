"use strict";

const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("value-help");

/*
 * On-premise S/4 reached through the Cloud Connector. The destination
 * carries the Location ID, so nothing here needs to know about the
 * connector itself.
 */
const DESTINATION_NAME = "DV1-230-S4HANA";

/*
 * Rows fetched when the client does not ask for a specific page size.
 * Fiori Elements typically requests its own $top, which is honoured up
 * to MAX_RESULTS - the cap exists so a stray request cannot pull an
 * unbounded result set across the Cloud Connector.
 */
const DEFAULT_RESULTS = 100;

const MAX_RESULTS = 500;

/**
 * Shared helpers for value helps served from S/4.
 *
 * Both the cost centre and GL account helps face the same two
 * problems: working out what the user typed, and reading a response
 * that may come back in either OData shape.
 */

/**
 * Normalizes the several shapes an S/4 OData response can take.
 *
 * @param {*} data
 * @returns {object[]}
 */
function extractRows(data) {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.value)) {
    return data.value;
  }

  if (data.d && Array.isArray(data.d.results)) {
    return data.d.results;
  }

  if (data.d && Array.isArray(data.d)) {
    return data.d;
  }

  return [];
}

/**
 * Pulls the text the user has typed out of a value-help query.
 *
 * Fiori Elements expresses it differently depending on how the help is
 * opened, so all the shapes it can arrive in are handled:
 *   - $search=10       -> SELECT.search
 *   - startswith(...)  -> a func token in the where-clause
 *   - contains(...)    -> likewise
 *   - field like 10%   -> CAP's own rewrite of the above
 *   - field eq 10      -> a plain equality
 *
 * @param {object} select - the CQN SELECT
 * @param {string} field - the value-help key field to look for
 * @returns {string} the typed text, or "" to list everything
 */
function extractSearchTerm(select, field) {
  if (!select) {
    return "";
  }

  if (Array.isArray(select.search) && select.search.length) {
    const token = select.search[0];

    const value = typeof token === "object" ? token.val : token;

    if (value) {
      return String(value).replace(/^"|"$/g, "");
    }
  }

  const where = select.where;

  if (!Array.isArray(where)) {
    return "";
  }

  for (let index = 0; index < where.length; index += 1) {
    const token = where[index];

    if (!token || typeof token !== "object") {
      continue;
    }

    if (token.func && Array.isArray(token.args)) {
      const onField = token.args.some(
        (arg) => arg && Array.isArray(arg.ref) && arg.ref.includes(field)
      );

      const literal = token.args.find((arg) => arg && arg.val !== undefined);

      if (onField && literal) {
        return String(literal.val);
      }
    }

    if (Array.isArray(token.ref) && token.ref[token.ref.length - 1] === field) {
      const value = where[index + 2];

      if (value && value.val !== undefined) {
        return String(value.val).replace(/%/g, "");
      }
    }
  }

  return "";
}

/**
 * Reads the page the client asked for out of a CQN SELECT.
 *
 * Fiori Elements pages value helps as the user scrolls, so honouring
 * $top / $skip is what allows more than the first page to be seen.
 *
 * @param {object} select - the CQN SELECT
 * @returns {{top: number, skip: number}}
 */
function extractPaging(select) {
  const limit = (select && select.limit) || {};

  const requested = Number(limit.rows && limit.rows.val);

  const offset = Number(limit.offset && limit.offset.val);

  return {
    top: Math.min(requested > 0 ? requested : DEFAULT_RESULTS, MAX_RESULTS),
    skip: offset > 0 ? offset : 0,
  };
}

/**
 * Builds an encoded query string for a value-help call.
 *
 * The query is encoded here and appended to the path rather than
 * handed over as params: the SDK does not encode them, and a value
 * containing spaces fails with "Request path contains unescaped
 * characters" before the request is even sent.
 *
 * Two flavours of service are supported. Some take a plain "search"
 * parameter (note: not "$search"); others expect an OData $filter,
 * which the caller builds.
 *
 * @param {object} options
 * @param {string} options.selectFields
 * @param {string} [options.term] - for search-style services
 * @param {string} [options.filter] - for $filter-style services
 * @returns {string}
 */
function buildQueryString({ selectFields, term, filter, top, skip }) {
  const parts = [
    `$select=${encodeURIComponent(selectFields)}`,
    `$top=${top || DEFAULT_RESULTS}`,
  ];

  if (skip) {
    parts.push(`$skip=${skip}`);
  }

  if (filter) {
    parts.unshift(`$filter=${encodeURIComponent(filter)}`);
  } else if (term) {
    parts.push(`search=${encodeURIComponent(term)}`);
  }

  return parts.join("&");
}

/**
 * Narrows a fuzzy value-help result down to real matches.
 *
 * Some S/4 value-help services treat their "search" parameter as a
 * HANA fuzzy search, so typing 741014001 comes back with 710014001 and
 * 741014101 alongside it. Those near misses are noise to a user who
 * typed a full code, so the rows are filtered - and ranked - against
 * what was actually typed.
 *
 * Rows are kept when the key starts with or contains the term, or when
 * the text does. Everything else is dropped. Ranking puts an exact key
 * match first, then key prefixes, then the rest, so the row the user
 * meant is at the top of the list.
 *
 * @param {object[]} rows - rows as returned by the service
 * @param {string} term - what the user typed
 * @param {object} fields
 * @param {string} fields.key - property holding the code
 * @param {string[]} [fields.text] - properties holding descriptions
 * @returns {object[]}
 */
function narrowToTerm(rows, term, { key, text = [] }) {
  const needle = String(term ?? "").trim().toUpperCase();

  if (!needle || !Array.isArray(rows)) {
    return rows || [];
  }

  const scored = [];

  for (const row of rows) {
    const code = String(row?.[key] ?? "").toUpperCase();

    if (code === needle) {
      scored.push({ row, rank: 0 });
      continue;
    }

    if (code.startsWith(needle)) {
      scored.push({ row, rank: 1 });
      continue;
    }

    if (code.includes(needle)) {
      scored.push({ row, rank: 2 });
      continue;
    }

    const matchesText = text.some((field) =>
      String(row?.[field] ?? "").toUpperCase().includes(needle)
    );

    if (matchesText) {
      scored.push({ row, rank: 3 });
    }
  }

  /*
   * A term that matches nothing at all is left alone: that is either a
   * typo the fuzzy search has usefully recovered from, or a service
   * whose rows simply do not carry the typed text.
   */
  if (!scored.length) {
    return rows;
  }

  return scored
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => entry.row);
}

/**
 * Calls an S/4 value-help service and returns its rows.
 *
 * @param {object} options
 * @param {string} options.path - service path on the destination
 * @param {string} options.selectFields - comma separated $select
 * @param {string} [options.term] - what the user has typed
 * @param {string} [options.filter] - an OData $filter, when the service wants one
 * @param {string} options.label - used in log messages
 * @returns {Promise<object[]>}
 * @throws {Error} with .statusCode and a message safe to show the user
 */
async function fetchValueHelp({ path, selectFields, term, filter, top, skip, label }) {
  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${DESTINATION_NAME}' was not found. ${label} could ` +
        "not be read."
    );

    error.statusCode = 500;

    throw error;
  }

  const query = buildQueryString({ selectFields, term, filter, top, skip });

  LOG.info(`Reading ${label}.`, JSON.stringify({ term, query }));

  try {
    const response = await executeHttpRequest(destination, {
      method: "GET",
      url: `${path}?${query}`,
      headers: { Accept: "application/json" },
    });

    const rows = extractRows(response && response.data);

    LOG.info(`${label} search returned ${rows.length} row(s).`);

    if (rows.length) {
      LOG.info(
        `First ${label} row shape:`,
        JSON.stringify(rows[0]).slice(0, 1800)
      );
    }

    return rows;
  } catch (error) {
    const detail =
      error?.response?.data?.error?.message?.value ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";

    LOG.error(`${label} search failed.`, {
      status: error?.response?.status,
      detail,
    });

    const wrapped = new Error(`Could not read ${label}: ${detail}`);

    wrapped.statusCode = error?.response?.status || 502;

    throw wrapped;
  }
}

module.exports = {
  extractRows,
  extractSearchTerm,
  narrowToTerm,
  extractPaging,
  buildQueryString,
  fetchValueHelp,
  DEFAULT_RESULTS,
  MAX_RESULTS,
};
