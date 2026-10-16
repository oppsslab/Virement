"use strict";

const cds = require("@sap/cds");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

// Matches db/data/ZDB_PPS_VIREMENT-RequestType.csv / -BudgetType.csv -
// kept in sync with the same mapping in requests-after-create-logic.js.
const REQUEST_TYPE_DESCR = { S: "Supplement", R: "Return", T: "Transfer" };
const BUDGET_TYPE_DESCR = { N: "Non Project", P: "Project" };

/**
 * Loads the header + item data needed to render the approval emails
 * (see approval-email-templates.js), fresh from the DB.
 *
 * requests-after-create-logic.js already has this data in hand at
 * submission time, so it builds the To Approver email directly
 * without this helper. This is for everywhere else an email needs to
 * be sent - approve-reject-request.js at level-advance, final
 * approval, and rejection - which only have a narrowly-selected
 * requestRow in hand and need the rest queried fresh.
 *
 * @param {object} tx
 * @param {string} requestId
 * @returns {Promise<object|null>}
 */
async function loadEmailContext(tx, requestId) {
  const { Requests, RequestItems } = cds.entities(SERVICE_NAMESPACE);

  const header = await tx.run(
    SELECT.one
      .from(Requests)
      .columns(
        "requestNumber",
        "requestLink",
        "fiscalYear",
        "departmentSection",
        "budgetType_code",
        "requestType_code",
        "transferOutAmount",
        "supplementAmount",
        "returnAmount",
      )
      .where({ ID: requestId }),
  );

  if (!header) {
    return null;
  }

  const items = await tx.run(
    SELECT.from(RequestItems)
      .columns(
        "costCentre",
        "glAccount",
        "material",
        "description",
        "department",
        "transferOutAmount",
        "transferInAmount",
        "supplementAmount",
        "returnAmount",
        "assetStatus_code",
      )
      .where({ request_ID: requestId })
      .orderBy("srNo"),
  );

  const requestAmount =
    header.requestType_code === "S"
      ? Number(header.supplementAmount)
      : header.requestType_code === "R"
        ? Number(header.returnAmount)
        : Number(header.transferOutAmount);

  return {
    requestNumber: header.requestNumber || "",
    requestLink: header.requestLink || "",
    fiscalYear: header.fiscalYear || "",
    departmentSection: header.departmentSection || "",
    budgetTypeDescr:
      BUDGET_TYPE_DESCR[header.budgetType_code] || header.budgetType_code || "",
    requestTypeDescr:
      REQUEST_TYPE_DESCR[header.requestType_code] || header.requestType_code || "",
    requestAmount: requestAmount || 0,
    items: items || [],
  };
}

module.exports = { loadEmailContext };
