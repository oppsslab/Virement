const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("cost-centers");

/*
 * On-premise S/4 system reached through the Cloud Connector. The
 * destination carries the Location ID, so nothing here needs to know
 * about the connector itself.
 */
const DESTINATION_NAME = "QA1-800-S4HANA";

const COST_CENTER_PATH = "/sap/opu/odata/sap/API_COSTCENTER_SRV/A_CostCenter";

const CONTROLLING_AREA = "1000";

const { DEFAULT_RESULTS } = require("./value-help");

/*
 * Navigation from A_CostCenter to its language-dependent texts.
 */
const TEXT_NAVIGATION = "to_Text";

/**
 * Escapes single quotes for an OData string literal.
 *
 * @param {string} value
 * @returns {string}
 */
function escapeODataLiteral(value) {
  return String(value ?? "").replace(/'/g, "''");
}

/**
 * Today's date as an OData V2 datetime literal, for a ValidityEndDate
 * filter.
 *
 * @returns {string} e.g. "datetime'2026-09-04T00:00:00'"
 */
function todayLiteral() {
  const today = new Date().toISOString().slice(0, 10);

  return `datetime'${today}T00:00:00'`;
}

/**
 * Builds the S/4 query string for a cost centre prefix.
 *
 * The query is encoded here and appended to the path, rather than
 * handed over as params. The filter contains spaces and quotes, and
 * passing it unencoded produced "Request path contains unescaped
 * characters" before the request was even sent.
 *
 * An empty prefix is allowed: startswith(CostCenter,'') matches every
 * cost centre, which is what the value help should show before the
 * user types anything.
 *
 * A_CostCenter carries one row per validity period, so a cost centre
 * that has ever been re-validated (a new period opened after an old
 * one lapsed) comes back as more than one row for the same code. Our
 * CostCenters entity keys only on the code, so two such rows collide
 * on that key once they reach the value-help table - which is why a
 * cost centre that is very much still active could appear to be
 * missing: the picker was rendering the lapsed row instead of the
 * current one. Restricting to ValidityEndDate >= today keeps only the
 * period that is current (or a future one), which is also the one a
 * new posting would actually use.
 *
 * @param {string} prefix
 * @param {boolean} withText - expand to_Text for the cost centre name
 * @returns {string} encoded query string, without the leading "?"
 */
function buildQueryString(prefix, withText, paging = {}) {
  const literal = escapeODataLiteral(prefix).toUpperCase();

  const filter =
    `ControllingArea eq '${CONTROLLING_AREA}' and ` +
    `startswith(CostCenter,'${literal}') and ` +
    `ValidityEndDate ge ${todayLiteral()}`;

  const parts = [
    `$filter=${encodeURIComponent(filter)}`,
    `$top=${paging.top || DEFAULT_RESULTS}`,
  ];

  if (paging.skip) {
    parts.push(`$skip=${paging.skip}`);
  }

  /*
   * The cost centre name is not a field on A_CostCenter - selecting it
   * directly returns "Resource not found for the segment
   * 'CostCenterName'". It lives in the to_Text entity instead.
   *
   * $select is deliberately omitted when expanding: in OData V2 a
   * $select that does not name the expanded paths strips them from the
   * response, which is why the first attempt came back with only
   * CostCenter and ControllingArea and no texts.
   */
  if (withText) {
    parts.push(`$expand=${encodeURIComponent(TEXT_NAVIGATION)}`);
  } else {
    parts.push(`$select=${encodeURIComponent("CostCenter,ControllingArea")}`);
  }

  return parts.join("&");
}

/**
 * Picks a cost centre name out of a row.
 *
 * The shape of an expanded text is not assumed: the navigation may be
 * named differently across releases, and the text row may carry the
 * value as CostCenterName or CostCenterDescription. So the row is
 * searched for any nested structure holding one of those fields,
 * preferring the English text when several languages come back.
 *
 * @param {object} row - one A_CostCenter row, possibly with expands
 * @returns {string}
 */
function extractName(row) {
  if (!row || typeof row !== "object") {
    return "";
  }

  const nameOf = (candidate) =>
    (candidate && (candidate.CostCenterName || candidate.CostCenterDescription)) ||
    "";

  /*
   * A release that exposes the text directly on the header.
   */
  const direct = nameOf(row);

  if (direct) {
    return direct;
  }

  for (const value of Object.values(row)) {
    if (!value || typeof value !== "object") {
      continue;
    }

    const candidates = Array.isArray(value)
      ? value
      : Array.isArray(value.results)
        ? value.results
        : [value];

    const english = candidates.find(
      (candidate) =>
        nameOf(candidate) &&
        String(candidate.Language || "").toUpperCase() === "EN"
    );

    const any = candidates.find((candidate) => nameOf(candidate));

    const picked = nameOf(english || any);

    if (picked) {
      return picked;
    }
  }

  return "";
}

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
 * Keeps one row per cost centre code.
 *
 * The ValidityEndDate filter in buildQueryString should already leave
 * at most one row per code, but this is the backstop if S/4 ever
 * returns overlapping validity periods anyway: a duplicate key reaching
 * the value-help table is exactly what let a genuinely current cost
 * centre appear to be missing, so the first row - the one this S/4
 * release happened to list first - is kept and the rest are dropped
 * rather than risk that again.
 *
 * @param {object[]} rows
 * @returns {object[]}
 */
function dedupeByCostCentre(rows) {
  const seen = new Set();

  return rows.filter((row) => {
    const code = String(row.costCentre ?? "").trim().toUpperCase();

    if (seen.has(code)) {
      return false;
    }

    seen.add(code);

    return true;
  });
}

/**
 * Reads cost centres from S/4 for the given prefix.
 *
 * @param {string} prefix - what the user has typed so far
 * @returns {Promise<Array<{costCentre: string, costCentreName: string, controllingArea: string}>>}
 * @throws {Error} with .statusCode and a message safe to show the user
 */
async function readCostCenters(prefix, paging = {}) {
  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${DESTINATION_NAME}' was not found. Cost centres ` +
        "could not be read."
    );

    error.statusCode = 500;

    throw error;
  }

  /*
   * Try with the text expand first; if this S/4 release does not offer
   * that navigation, fall back to codes only rather than failing the
   * whole value help.
   */
  const attempts = [
    { withText: true, label: "with to_Text" },
    { withText: false, label: "codes only" },
  ];

  let lastError = null;

  for (const attempt of attempts) {
    const query = buildQueryString(prefix, attempt.withText, paging);

    LOG.info(
      "Reading cost centres.",
      JSON.stringify({ prefix, attempt: attempt.label, query })
    );

    try {
      const response = await executeHttpRequest(destination, {
        method: "GET",
        url: `${COST_CENTER_PATH}?${query}`,
        headers: { Accept: "application/json" },
      });

      const rows = extractRows(response && response.data);

      LOG.info(
        `Cost centre search returned ${rows.length} row(s) (${attempt.label}).`
      );

      /*
       * Log the shape of the first row once per call, so an empty name
       * can be diagnosed from the response rather than guessed at.
       */
      if (rows.length) {
        LOG.info(
          "First cost centre row shape:",
          JSON.stringify(rows[0]).slice(0, 1800)
        );
      }

      return dedupeByCostCentre(
        rows.map((row) => ({
          costCentre: row.CostCenter,
          costCentreName: extractName(row),
          controllingArea: row.ControllingArea,
        }))
      );
    } catch (error) {
      const detail =
        error?.response?.data?.error?.message?.value ||
        error?.response?.data?.error?.message ||
        error?.message ||
        "Unknown error";

      LOG.error(`Cost centre search failed (${attempt.label}).`, {
        status: error?.response?.status,
        detail,
      });

      lastError = { detail, status: error?.response?.status };
    }
  }

  const wrapped = new Error(`Could not read cost centres: ${lastError.detail}`);

  wrapped.statusCode = lastError.status || 502;

  throw wrapped;
}

/**
 * Checks which of the given cost centre codes actually exist in S/4.
 *
 * The value help only ever offers real codes, but nothing stops a user
 * typing or pasting one in directly (as on the upload template), so
 * this is the check that catches a bad code before it reaches an S/4
 * posting - where it fails far less clearly.
 *
 * All codes are checked in a single request rather than one per code,
 * to keep this cheap enough to run on every submit.
 *
 * @param {string[]} codes - cost centre codes to check, as entered
 * @returns {Promise<Set<string>>} the subset that exist in S/4, uppercased
 * @throws {Error} with .statusCode and a message safe to show the user
 */
async function findExistingCostCentres(codes) {
  const uniqueCodes = [
    ...new Set(
      (codes || [])
        .map((code) => String(code ?? "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (!uniqueCodes.length) {
    return new Set();
  }

  const destination = await getDestination({
    destinationName: DESTINATION_NAME,
  });

  if (!destination) {
    const error = new Error(
      `Destination '${DESTINATION_NAME}' was not found. Cost centres ` +
        "could not be validated."
    );

    error.statusCode = 500;

    throw error;
  }

  const codeFilter = uniqueCodes
    .map((code) => `CostCenter eq '${escapeODataLiteral(code)}'`)
    .join(" or ");

  /*
   * Without the validity filter, a code with more than one validity
   * period (the norm - see buildQueryString above) can return more
   * than one row, and $top capped at the code count then lets one
   * code's history crowd out another code's row entirely: a perfectly
   * valid cost centre comes back missing from the response and gets
   * wrongly reported as invalid. The same ValidityEndDate filter used
   * for the value help keeps this to at most one row per code.
   */
  const filter =
    `ControllingArea eq '${CONTROLLING_AREA}' and (${codeFilter}) and ` +
    `ValidityEndDate ge ${todayLiteral()}`;

  const query = [
    `$filter=${encodeURIComponent(filter)}`,
    `$select=${encodeURIComponent("CostCenter")}`,
    `$top=${uniqueCodes.length}`,
  ].join("&");

  LOG.info(
    "Validating cost centres.",
    JSON.stringify({ codes: uniqueCodes, query })
  );

  try {
    const response = await executeHttpRequest(destination, {
      method: "GET",
      url: `${COST_CENTER_PATH}?${query}`,
      headers: { Accept: "application/json" },
    });

    const rows = extractRows(response && response.data);

    return new Set(
      rows.map((row) => String(row.CostCenter ?? "").trim().toUpperCase())
    );
  } catch (error) {
    const detail =
      error?.response?.data?.error?.message?.value ||
      error?.response?.data?.error?.message ||
      error?.message ||
      "Unknown error";

    LOG.error("Cost centre validation failed.", {
      status: error?.response?.status,
      detail,
    });

    const wrapped = new Error(`Could not validate cost centres: ${detail}`);

    wrapped.statusCode = error?.response?.status || 502;

    throw wrapped;
  }
}

module.exports = {
  readCostCenters,
  findExistingCostCentres,
  buildQueryString,
  extractRows,
  extractName,
};
