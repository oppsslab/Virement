"use strict";

const cds = require("@sap/cds");

const {
  buildToApproverItemsTable,
  buildApprovedItemsTable,
} = require("./approval-email-templates");

const LOG = cds.log("email-config-renderer");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

const EMAIL_TYPE = {
  TO_APPROVER: "ToApprover",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/*
 * Every placeholder token an admin can use in a template's subject/
 * body, and how each resolves at send time. {{ItemsTable}} is the one
 * exception - see approval-email-templates.js's export comment - it's
 * replaced with a fully system-generated table, not a plain string.
 */
function substitutePlaceholders(text, values) {
  return String(text || "").replace(/{{\s*(\w+)\s*}}/g, (match, token) =>
    token in values ? String(values[token]) : match,
  );
}

function formatAmount(value) {
  return (Number(value) || 0).toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function buildItemsTableHtml(emailType, data) {
  if (emailType === EMAIL_TYPE.TO_APPROVER) {
    return buildToApproverItemsTable(data.items);
  }

  if (emailType === EMAIL_TYPE.APPROVED) {
    return buildApprovedItemsTable(data.items, {
      documentNumber: data.documentNumber,
    });
  }

  return "";
}

/**
 * Renders an EmailConfiguration row's subject/body against real
 * request data, substituting every {{Token}} placeholder.
 *
 * @param {object} tx
 * @param {string} emailType - ToApprover/Approved/Rejected
 * @param {object} data - requestNumber, departmentSection, fiscalYear,
 *   budgetTypeDescr, requestTypeDescr, requestAmount, documentNumber,
 *   items
 * @param {object} [options]
 * @param {boolean} [options.ignoreEnabled] - true for a test send, so
 *   an admin can preview a currently-disabled template
 * @returns {Promise<{subject: string, body: string}|null>} null if
 *   disabled (and not ignored) or the config row is missing
 */
async function renderEmailConfig(tx, emailType, data, options = {}) {
  const { EmailConfiguration } = cds.entities(SERVICE_NAMESPACE);

  const config = await tx.run(
    SELECT.one.from(EmailConfiguration).where({ emailType }),
  );

  if (!config) {
    LOG.warn(`No EmailConfiguration row found for "${emailType}".`);

    return null;
  }

  if (!config.enabled && !options.ignoreEnabled) {
    LOG.info(`Email type "${emailType}" is switched off - not sending.`);

    return null;
  }

  const values = {
    RequestNumber: data.requestNumber || "",
    RequestLink: data.requestLink || "",
    RequestorDepartment: data.departmentSection || "",
    FiscalYear: data.fiscalYear || "",
    BudgetTypeDescr: data.budgetTypeDescr || "",
    RequestTypeDescr: data.requestTypeDescr || "",
    RequestAmount: formatAmount(data.requestAmount),
    DocumentNumber: data.documentNumber || "",
    RejectionReason: data.rejectionReason || "",
    ItemsTable: buildItemsTableHtml(emailType, data),
  };

  return {
    subject: substitutePlaceholders(config.subject, values),
    body: substitutePlaceholders(config.body, values),
  };
}

/*
 * Sample data for the "Send Test Email" action - obviously-fake
 * values so a test send is never mistaken for a real notification,
 * with enough sample item rows to verify the {{ItemsTable}} rendering
 * too.
 */
function sampleEmailData() {
  return {
    requestNumber: "N00000000",
    requestLink: "#",
    departmentSection: "Sample Department",
    fiscalYear: "2026",
    budgetTypeDescr: "Non Project",
    requestTypeDescr: "Transfer",
    requestAmount: 1000,
    documentNumber: "DOC0000000",
    rejectionReason: "Sample rejection reason",
    items: [
      {
        costCentre: "1000000000",
        glAccount: "100000",
        material: "100000000",
        description: "Sample Item 1",
        department: "Sample Department",
        transferOutAmount: 500,
        transferInAmount: 0,
        assetStatus_code: "",
      },
      {
        costCentre: "2000000000",
        glAccount: "200000",
        material: "200000000",
        description: "Sample Item 2",
        department: "Sample Department",
        transferOutAmount: 0,
        transferInAmount: 500,
        assetStatus_code: "",
      },
    ],
  };
}

module.exports = {
  EMAIL_TYPE,
  renderEmailConfig,
  sampleEmailData,
};
