const cds = require("@sap/cds");

const LOG = cds.log("recent-requests-read-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const MAX_RECENT_REQUESTS = 3;

/**
 * Reads the 3 most recent requests created by the current user.
 *
 * Returns data for custom entity:
 *   RecentRequests {
 *     ID,
 *     requestNumber,
 *     requestType,
 *     status
 *   }
 *
 * @param {cds.Request} request - CAP request context
 * @returns {Array<Object>}
 */
module.exports = async function readRecentRequests(request) {
  LOG.info("--- READ RecentRequests started ---");

  try {
    const tx = cds.tx(request);
    const serviceEntities = cds.entities(SERVICE_NAMESPACE);

    if (!serviceEntities || !serviceEntities.Requests) {
      LOG.error("Requests entity not found in namespace:", SERVICE_NAMESPACE);

      return request.error(
        500,
        "Internal configuration error: Requests entity not found."
      );
    }

    const { Requests, RequestType, RequestStatus } = serviceEntities;

    const userId = request.user && request.user.id;

    if (!userId) {
      LOG.warn("No user ID found. Returning empty RecentRequests list.");
      return [];
    }

    LOG.info("Reading recent requests for user:", userId);

    /*
     * Read from the service Requests entity.
     * Only select simple persisted fields to avoid virtual/draft issues.
     */
    const rows = await tx.run(
      SELECT.from(Requests)
        .columns(
          "ID",
          "requestNumber",
          "requestType_code",
          "status_code",
          "createdAt"
        )
        .where({ createdBy: userId })
        .orderBy("createdAt desc")
        .limit(MAX_RECENT_REQUESTS)
    );

    if (!rows || rows.length === 0) {
      LOG.info("No recent requests found.");
      return [];
    }

    const requestTypeCodes = [
      ...new Set(
        rows
          .map(function (row) {
            return row.requestType_code;
          })
          .filter(Boolean)
      ),
    ];

    const statusCodes = [
      ...new Set(
        rows
          .map(function (row) {
            return row.status_code;
          })
          .filter(function (value) {
            return value !== null && value !== undefined;
          })
      ),
    ];

    const requestTypeTexts = await readRequestTypeTexts(
      tx,
      RequestType,
      requestTypeCodes
    );

    const statusTexts = await readStatusTexts(
      tx,
      RequestStatus,
      statusCodes
    );

    const result = rows.map(function (row) {
      return {
        ID: row.ID,
        requestNumber: row.requestNumber,
        requestType:
          requestTypeTexts[row.requestType_code] ||
          row.requestType_code ||
          "",
        status:
          statusTexts[row.status_code] ||
          (
            row.status_code !== null && row.status_code !== undefined
              ? String(row.status_code)
              : ""
          ),
      };
    });

    LOG.info("Returning RecentRequests:", JSON.stringify(result));
    LOG.info("--- READ RecentRequests ended successfully ---");

    return result;
  } catch (error) {
    LOG.error("Error in recent-requests-read-logic:", error);

    return request.error(
      500,
      "Could not read recent requests."
    );
  }
};

/**
 * Reads request type descriptions.
 *
 * @param {object} tx - CAP transaction
 * @param {object} RequestType - RequestType entity
 * @param {Array<string>} codes - request type codes
 * @returns {Object} map: code -> descr
 */
async function readRequestTypeTexts(tx, RequestType, codes) {
  const map = {};

  if (!codes || codes.length === 0) {
    return map;
  }

  if (!RequestType) {
    LOG.warn("RequestType entity not found. Using requestType_code as text.");
    return map;
  }

  const rows = await tx.run(
    SELECT.from(RequestType)
      .columns("code", "descr")
      .where({ code: { in: codes } })
  );

  rows.forEach(function (row) {
    map[row.code] = row.descr || row.code;
  });

  return map;
}

/**
 * Reads request status descriptions.
 *
 * @param {object} tx - CAP transaction
 * @param {object} RequestStatus - RequestStatus entity
 * @param {Array<number|string>} codes - status codes
 * @returns {Object} map: code -> descr
 */
async function readStatusTexts(tx, RequestStatus, codes) {
  const map = {};

  if (!codes || codes.length === 0) {
    return map;
  }

  if (!RequestStatus) {
    LOG.warn("RequestStatus entity not found. Using status_code as text.");
    return map;
  }

  const rows = await tx.run(
    SELECT.from(RequestStatus)
      .columns("code", "descr")
      .where({ code: { in: codes } })
  );

  rows.forEach(function (row) {
    map[row.code] = row.descr || String(row.code);
  });

  return map;
}