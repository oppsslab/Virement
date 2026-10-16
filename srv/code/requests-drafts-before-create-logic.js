const cds = require("@sap/cds");
const { getLocalDateParts } = require("./utils/date-utils");
const { REQUEST_STATUS } = require("./utils/request-status");
const { fetchUserDepartment } = require("./utils/ias-user-directory");

const LOG = cds.log("requests-drafts-before-create-logic");

// =============================================================================
//  HELPERS
// =============================================================================

/**
 * Initializes default values for a new Request draft.
 * Sets requestor, departmentSection, fiscalYear, and status if not
 * already provided.
 *
 * departmentSection comes from the IAS Identity Directory's
 * Department field, looked up directly via SCIM (see
 * utils/ias-user-directory.js) rather than from the login token -
 * confirmed live that this app's token never carries it, regardless
 * of IAS Application attribute configuration. Was originally Cost
 * Center, switched to Department since Cost Center is empty for many
 * employees in the live directory while Department is reliably
 * populated.
 *
 * @param {Object} data - the incoming request.data object
 * @param {Object} user - the current user (from request.user)
 * @returns {Promise<Object>} the populated data object
 */
async function initializeRequestDefaults(data, user) {
  const { year } = getLocalDateParts(new Date());

  data.requestor = data.requestor || user?.id;
  data.departmentSection =
    data.departmentSection || (await fetchUserDepartment(user?.id));
  data.fiscalYear = data.fiscalYear || String(year);
  data.status_code = data.status_code ?? REQUEST_STATUS.DRAFT;

  return data;
}

// =============================================================================
//  MAIN HANDLER
//
//  @Before(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests.drafts")
//
//  Before a new Request draft is created, initializes default values:
//  - requestor: current user ID (if not provided)
//  - fiscalYear: current calendar year (if not provided)
//  - status_code: DRAFT status (if not provided)
//
//  Registered ONLY for the draft entity (new request creation).
// =============================================================================

/**
 * @param {cds.Request} request - the CAP request context
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE Requests.drafts started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Incoming request.data:", JSON.stringify(request.data || {}));
    LOG.info("Request params:", JSON.stringify(request.params || []));

    // 1. Ensure request.data exists.
    request.data = request.data || {};

    // 2. Initialize default values (requestor, fiscalYear, status).
    await initializeRequestDefaults(request.data, request.user);

    LOG.info("Set requestor:", request.data.requestor);
    LOG.info("Set fiscalYear:", request.data.fiscalYear);
    LOG.info("Set status_code:", request.data.status_code);

    // 3. Log the final state.
    LOG.info("Final request.data:", JSON.stringify(request.data || {}));
    LOG.info("--- BEFORE CREATE Requests.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-drafts-before-create-logic:", error);
    request.error(
      500,
      "An error occurred while initializing the request draft.",
    );
  }
};
