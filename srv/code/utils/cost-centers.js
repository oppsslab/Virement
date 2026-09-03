const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const LOG = cds.log("cost-centers");

/*
 * On-premise S/4 system reached through the Cloud Connector. The
 * destination carries the Location ID, so nothing here needs to know
 * about the connector itself.
 */
const DESTINATION_NAME = "DV1-230-S4HANA";

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
 * @param {string} prefix
 * @param {boolean} withText - expand to_Text for the cost centre name
 * @returns {string} encoded query string, without the leading "?"
 */
function buildQueryString(prefix, withText, paging = {}) {
  const literal = escapeODataLiteral(prefix).toUpperCase();

  const filter =
    `ControllingArea eq '${CONTROLLING_AREA}' and ` +
    `startswith(CostCenter,'${literal}')`;

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

      return rows.map((row) => ({
        costCentre: row.CostCenter,
        costCentreName: extractName(row),
        controllingArea: row.ControllingArea,
      }));
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

module.exports = {
  readCostCenters,
  buildQueryString,
  extractRows,
  extractName,
};
