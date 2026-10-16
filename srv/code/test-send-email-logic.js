"use strict";

const cds = require("@sap/cds");

const {
  renderEmailConfig,
  sampleEmailData,
} = require("./utils/email-config-renderer");

const { sendEmail } = require("./utils/send-email");

const LOG = cds.log("test-send-email-logic");

/**
 * @On("testSendEmail")
 *
 * Renders the acted-on EmailConfiguration row's current subject/body
 * against sample (obviously-fake) data and sends it to the given
 * recipient, so an admin can verify a template edit before it goes
 * out for real. Ignores the row's own enabled switch - testing a
 * currently-disabled template should still work.
 *
 * @param {cds.Request} request
 */
module.exports = async function testSendEmail(request) {
  const emailType = request.params?.[0]?.emailType;
  const recipient = String(request.data?.recipient || "").trim();

  if (!emailType) {
    request.error(400, "Unable to determine which email template to test.");

    return;
  }

  if (!recipient) {
    request.error(400, "A recipient email address is required.");

    return;
  }

  const tx = cds.tx(request);

  const rendered = await renderEmailConfig(tx, emailType, sampleEmailData(), {
    ignoreEnabled: true,
  });

  if (!rendered) {
    request.error(
      404,
      `No email configuration found for "${emailType}".`,
    );

    return;
  }

  const sent = await sendEmail({
    subject: `[TEST] ${rendered.subject}`,
    body: rendered.body,
    recipients: [recipient],
  });

  if (!sent) {
    LOG.error("Test email send failed.", { emailType, recipient });

    request.error(
      502,
      "The test email could not be sent. Check the server logs for details.",
    );

    return;
  }

  return `Test email sent to ${recipient}.`;
};
