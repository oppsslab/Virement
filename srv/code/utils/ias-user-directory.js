"use strict";

const https = require("https");
const cds = require("@sap/cds");
const xsenv = require("@sap/xsenv");

const LOG = cds.log("ias-user-directory");

const ENTERPRISE_SCHEMA =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

/*
 * Confirmed live (a full raw JWT payload dump) that this app's actual
 * login token always has "xs.user.attributes": {} - empty - regardless
 * of the IAS Application's own Self-defined Attributes configuration.
 * The browser authenticates through a SaaS approuter that performs an
 * XSUAA "user_token" exchange, and that exchange does not carry
 * custom IAS profile attributes into the resulting token. Rather than
 * depend on BTP Trust Configuration we don't have full control over,
 * this looks the value up directly from the IAS Identity Directory's
 * own SCIM API.
 *
 * Auth: a dedicated IAS system API client (granted "Read Users"),
 * client_id/client_secret via environment variables
 * IAS_SCIM_CLIENT_ID / IAS_SCIM_CLIENT_SECRET - never committed to
 * the repo, set directly on the virement-srv app (`cf set-env`). The
 * tenant base URL is still read from the `virement-ias` binding
 * (xsenv) - that part is not sensitive.
 */

let cachedTenantUrl = null;
let cachedToken = null; // { value, expiresAt }

function getTenantUrl() {
  if (!cachedTenantUrl) {
    const { identity } = xsenv.getServices({
      identity: { name: "virement-ias" },
    });

    cachedTenantUrl = identity.url;
  }

  return cachedTenantUrl;
}

function getScimClientCredentials() {
  const clientId = process.env.IAS_SCIM_CLIENT_ID;
  const clientSecret = process.env.IAS_SCIM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "IAS_SCIM_CLIENT_ID / IAS_SCIM_CLIENT_SECRET environment variables are not set.",
    );
  }

  return { clientId, clientSecret };
}

function requestJson({ hostname, path, method, headers, body, cert, key }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, path, method, headers, cert, key },
      (res) => {
        let raw = "";

        res.on("data", (chunk) => {
          raw += chunk;
        });

        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              `IAS request to ${path} failed with status ${res.statusCode}: ${raw.slice(0, 500)}`,
            );

            error.statusCode = res.statusCode;
            reject(error);
            return;
          }

          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (parseError) {
            reject(parseError);
          }
        });
      },
    );

    req.on("error", reject);

    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 30000) {
    return cachedToken.value;
  }

  const { clientId, clientSecret } = getScimClientCredentials();
  const tokenUrl = new URL(`${getTenantUrl()}/oauth2/token`);

  const body = new URLSearchParams({
    grant_type: "client_credentials",
  }).toString();

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await requestJson({
    hostname: tokenUrl.hostname,
    path: tokenUrl.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });

  cachedToken = {
    value: response.access_token,
    expiresAt: now + (Number(response.expires_in) || 3600) * 1000,
  };

  return cachedToken.value;
}

/**
 * Looks up a user's Department directly from the IAS Identity
 * Directory's SCIM API, by email - see this file's header comment
 * for why the login token itself can't be used instead.
 *
 * Was originally Cost Center, but that field is empty for many
 * employees in the live directory (confirmed via the IAS Admin
 * Console's own Employee Information screen) while Department is
 * reliably populated - both are plain sibling attributes on the same
 * SCIM Enterprise User extension schema, so this is a one-field
 * change, not a different lookup mechanism.
 *
 * Best-effort: never throws - a lookup failure (missing API
 * permission, network error, user not found) is logged and resolves
 * to "" rather than blocking draft creation.
 *
 * @param {string} email
 * @returns {Promise<string>}
 */
async function fetchUserDepartment(email) {
  const trimmedEmail = String(email || "").trim();

  if (!trimmedEmail) {
    return "";
  }

  try {
    const accessToken = await getAccessToken();

    // IAS's SCIM "userName" is the Login Name (e.g. "PWC_RAY"), not the
    // email - this app only ever knows the user's email (from the login
    // token's user id), so look up by the emails[].value attribute instead.
    const filter = `emails.value eq "${trimmedEmail.replace(/"/g, '\\"')}"`;
    const scimUrl = new URL(
      `${getTenantUrl()}/scim/Users?filter=${encodeURIComponent(filter)}`,
    );

    const response = await requestJson({
      hostname: scimUrl.hostname,
      path: `${scimUrl.pathname}${scimUrl.search}`,
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const user = response?.Resources?.[0];
    const department = user?.[ENTERPRISE_SCHEMA]?.department;

    const result = Array.isArray(department)
      ? department.filter(Boolean).join(", ")
      : String(department ?? "").trim();

    LOG.info(
      "Looked up Department from IAS Identity Directory.",
      JSON.stringify({ email: trimmedEmail, department: result }),
    );

    return result;
  } catch (error) {
    LOG.warn(
      `Could not look up Department for "${trimmedEmail}" from IAS Identity Directory:`,
      JSON.stringify({ message: error.message, statusCode: error.statusCode }),
    );

    return "";
  }
}

module.exports = { fetchUserDepartment };
