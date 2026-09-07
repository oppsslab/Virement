const cds = require("@sap/cds");

const insertRequestHistory = require("./insert-request-history");

const { REQUEST_STATUS, APPROVER_STATUS } = require("./utils/request-status");

const LOG = cds.log("assign-approvers");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Parses the incoming level value into a positive integer.
 *
 * @param {string|number} level
 * @returns {number|null} the parsed level, or null if invalid
 */
function parseApprovalLevel(level) {
  const normalizedLevel = Number(String(level ?? "").trim());

  if (!Number.isInteger(normalizedLevel) || normalizedLevel < 1) {
    return null;
  }

  return normalizedLevel;
}

/**
 * Extracts an email address from a single approver entry.
 *
 * The CDS action parameter uses "Email" as the property name to
 * exactly match the decision table's output field
 * (Approvers[].Email), since SAP Build's "Bind List" feature
 * performs a structural field-name match and silently drops
 * fields whose names do not match exactly.
 *
 * Other property name variants are still tolerated here as a
 * safety net, in case this action is ever invoked from a
 * different caller (e.g. a manual test, or a future workflow
 * revision) using a different naming convention.
 *
 * @param {object|string} approver
 * @returns {string}
 */
function extractEmailAddress(approver) {
  if (typeof approver === "string") {
    return approver.trim();
  }

  if (!approver || typeof approver !== "object") {
    return "";
  }

  const candidateKeys = [
    "Email",
    "emailAddress",
    "email",
    "EMAILADDRESS",
    "EmailAddress",
    "mail",
    "Mail",
  ];

  for (const key of candidateKeys) {
    const value = approver[key];

    if (value !== undefined && value !== null) {
      const stringValue =
        typeof value === "object" && "value" in value ? value.value : value;

      const trimmed = String(stringValue || "").trim();

      if (trimmed) {
        return trimmed;
      }
    }
  }

  return "";
}

/**
 * Normalizes the approvers payload into a flat array of raw
 * approver entries, tolerating a few possible top-level shapes.
 *
 * @param {*} approvers
 * @returns {object[]}
 */
function normalizeApproversInput(approvers) {
  if (Array.isArray(approvers)) {
    return approvers;
  }

  if (approvers && typeof approvers === "object") {
    if (Array.isArray(approvers.value)) {
      return approvers.value;
    }

    return [approvers];
  }

  return [];
}

/**
 * Normalizes the approvers payload into a list of valid
 * RequestApprovers row candidates.
 *
 * @param {*} approvers
 * @param {string} requestId
 * @param {number} level
 * @returns {object[]}
 */
function buildApproverRows(approvers, requestId, level) {
  const normalizedApprovers = normalizeApproversInput(approvers);

  return normalizedApprovers
    .map(function (approver) {
      return {
        request_ID: requestId,
        emailAddress: extractEmailAddress(approver),
        level,
        status_code: String(level || "").startsWith("1") ? APPROVER_STATUS.PENDING_APPROVAL : APPROVER_STATUS.INACTIVE,
      };
    })
    .filter(function (row) {
      return Boolean(row.emailAddress);
    });
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @On("assignApprovers")
 *
 * Called by the BPA workflow's Service Task, placed immediately
 * after a decision table resolves the eligible approvers for a
 * given level.
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- assignApprovers started ---");

  LOG.info("Raw incoming request.data:", JSON.stringify(request.data, null, 2));

  const { requestId, level, approvers } = request.data;

  try {
    if (!requestId) {
      request.error(400, "requestId is required.");
      return false;
    }

    const normalizedLevel = level;

    // const normalizedLevel = parseApprovalLevel(level);

    // if (normalizedLevel === null) {
    //   LOG.error("Invalid level received:", level);

    //   request.error(400, "level must resolve to a positive integer.");

    //   return false;
    // }

    const normalizedApprovers = normalizeApproversInput(approvers);

    LOG.info(
      "Normalized approvers array before email extraction:",
      JSON.stringify(normalizedApprovers, null, 2),
    );

    if (normalizedApprovers.length === 0) {
      // request.error(400, "approvers must be a non-empty array.");
      return false;
    }

    const tx = cds.tx(request);

    const { Requests, RequestApprovers } = cds.entities(SERVICE_NAMESPACE);

    const existingRequest = await tx.run(
      SELECT.one.from(Requests).columns("ID").where({ ID: requestId }),
    );

    if (!existingRequest) {
      LOG.error("Request not found:", requestId);

      request.error(404, `Request ${requestId} was not found.`);

      return false;
    }

    const rowsToInsert = buildApproverRows(
      approvers,
      requestId,
      normalizedLevel,
    );

    LOG.info(
      "Approver rows built after email extraction:",
      JSON.stringify(rowsToInsert),
    );

    if (rowsToInsert.length === 0) {
      LOG.error(
        "No valid approver email addresses could be extracted. " +
          "Raw approvers payload was:",
        JSON.stringify(approvers),
      );

      request.error(400, "No valid approver email addresses were provided.");

      return false;
    }

    LOG.info("Inserting RequestApprovers rows:", JSON.stringify(rowsToInsert));

    await tx.run(INSERT.into(RequestApprovers).entries(rowsToInsert));

    if (String(normalizedLevel || "").startsWith("1")){
      await tx.run(
        UPDATE(Requests)
          .set({ currentApprovalLevel: 1 })
          .where({ ID: requestId }),
      );
    }

    const approverEmails = rowsToInsert
      .map(function (row) {
        return row.emailAddress;
      })
      .join(", ");

    await insertRequestHistory(
      request,
      requestId,
      `Level ${normalizedLevel} approvers assigned: ${approverEmails}`,
    );

    LOG.info("--- assignApprovers completed successfully ---");

    return true;
  } catch (error) {
    LOG.error(
      "Error in assignApprovers:",
      JSON.stringify({
        requestId,
        level,
        message: error.message,
        stack: error.stack,
      }),
    );

    request.error(
      error.statusCode || 500,
      error.message || "Failed to assign approvers.",
    );

    return false;
  }
};
