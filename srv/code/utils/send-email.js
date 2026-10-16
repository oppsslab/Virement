"use strict";

const cds = require("@sap/cds");

const { getDestination } = require("@sap-cloud-sdk/connectivity");

const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");

const { getConfigValue } = require("./system-config");

const LOG = cds.log("send-email");

// Same direct-S/4 destination already used for native OData calls in
// cost-centers.js/value-help.js (confirmed to be the same S/4 system/
// client as this custom Email service). Overridable via the System
// Configuration admin page - e.g. for a PRD subaccount pointing at a
// different S/4 system/destination.
const DESTINATION_NAME_DEFAULT = "QA1-800-S4HANA";

const EMAIL_SERVICE_PATH =
  "/sap/opu/odata4/sap/zsb_sca_email_o4/srvd_a2x/sap/zsd_sca_email/0001/";

const SEND_EMAIL_PATH = `${EMAIL_SERVICE_PATH}Email/SAP__self.sendEmail`;

/**
 * Fetches a CSRF token (and the session cookie it's bound to) from
 * the service root - required before this OData service will accept
 * a POST. Requested against the service root, not the action path
 * itself, same as any other SAP CSRF-protected OData service.
 *
 * @param {object} destination
 * @returns {Promise<{token: string, cookies: string[]}>}
 */
async function fetchCsrfToken(destination) {
  const response = await executeHttpRequest(destination, {
    method: "HEAD",
    url: EMAIL_SERVICE_PATH,
    headers: { "X-CSRF-Token": "Fetch" },
  });

  const token = response.headers?.["x-csrf-token"];

  if (!token) {
    throw new Error("CSRF token was not returned by the service root.");
  }

  const setCookie = response.headers?.["set-cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  return { token, cookies };
}

/**
 * Sends an email via the S/4 custom Email OData v4 service
 * (ZSB_SCA_EMAIL_O4), replacing the earlier approach of passing
 * subject/body text into the BPA workflow's Start Event for it to
 * send instead.
 *
 * Best-effort: never throws. A failure here is a notification/
 * housekeeping issue, not a business failure - the approval itself
 * must not be blocked by a failed email send, same reasoning as the
 * BPA task-completion error handling in approve-reject-request.js.
 *
 * @param {object} params
 * @param {string} params.subject
 * @param {string} params.body - HTML
 * @param {string[]} params.recipients - joined with ";" per the API's
 *   documented multi-recipient format
 * @param {string[]} [params.cc]
 * @returns {Promise<boolean>} true if the send succeeded
 */
async function sendEmail({ subject, body, recipients, cc }) {
  const recipientList = (recipients || []).filter(Boolean);

  if (!recipientList.length) {
    LOG.warn("No recipients given - skipping email send.", {
      subject,
    });

    return false;
  }

  try {
    const DESTINATION_NAME = await getConfigValue(
      "S4_DESTINATION_NAME",
      DESTINATION_NAME_DEFAULT,
    );

    const destination = await getDestination({
      destinationName: DESTINATION_NAME,
    });

    if (!destination) {
      throw new Error(`Destination '${DESTINATION_NAME}' was not found.`);
    }

    const { token: csrfToken, cookies } = await fetchCsrfToken(destination);

    await executeHttpRequest(destination, {
      method: "POST",
      url: SEND_EMAIL_PATH,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
      },
      data: {
        Subject: subject || "",
        Body: body || "",
        Recipient: recipientList.join(";"),
        Cc: (cc || []).filter(Boolean).join(";"),
        IsHtml: true,
      },
    });

    LOG.info("Email sent.", JSON.stringify({ subject, recipientList }));

    return true;
  } catch (error) {
    LOG.error(
      "Failed to send email - continuing without blocking the caller.",
      JSON.stringify({
        subject,
        recipientList,
        message: error.message,
        status: error.response?.status || error.statusCode,
      }),
    );

    return false;
  }
}

module.exports = { sendEmail };
