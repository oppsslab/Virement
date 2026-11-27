"use strict";

const https = require("https");
const cds = require("@sap/cds");
const xsenv = require("@sap/xsenv");

const LOG = cds.log("ias-user-directory");

const CUSTOM_ATTRIBUTES_SCHEMA =
  "urn:sap:cloud:scim:schemas:extension:custom:2.0:User";

/*
 * Department/Section is sourced from IAS's own numbered "Custom
 * Attribute 9" (IAS Admin Console: Identity Providers > a user >
 * Custom Attributes), not the SCIM Enterprise User extension's
 * "department" field this originally read - that field is populated
 * with a generic value ("Administration") for every employee here,
 * while Custom Attribute 9 carries the real Jabatan/Section value.
 * Confirmed via a raw SCIM response dump: custom attributes live
 * under their own schema as an array of {name, value} pairs (not a
 * flat object like the enterprise extension), keyed by a fixed
 * technical name "customAttribute9" rather than the human label
 * ("Custom Attribute 9") shown in the admin console.
 */
const DEPARTMENT_CUSTOM_ATTRIBUTE_NAME = "customAttribute9";

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
 * Looks up a user's Department/Section directly from the IAS
 * Identity Directory's SCIM API, by email - see this file's header
 * comment for why the login token itself can't be used instead.
 *
 * Reads IAS's numbered "Custom Attribute 9" (see
 * DEPARTMENT_CUSTOM_ATTRIBUTE_NAME above) - earlier revisions read
 * Cost Center, then the SCIM Enterprise User extension's "department"
 * field, both abandoned because they were empty or genericized for
 * many employees in the live directory; Custom Attribute 9 is what
 * actually carries the real Jabatan/Section value.
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

    const customAttributes =
      user?.[CUSTOM_ATTRIBUTES_SCHEMA]?.attributes || [];

    const departmentAttribute = customAttributes.find(
      (attribute) => attribute?.name === DEPARTMENT_CUSTOM_ATTRIBUTE_NAME,
    );

    const result = String(departmentAttribute?.value ?? "").trim();

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
