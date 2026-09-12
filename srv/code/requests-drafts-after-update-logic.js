const cds = require("@sap/cds");
const { refreshDraftApproverPreview } = require("./utils/apply-approver-plan");

const LOG = cds.log("requests-drafts-after-update-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/* ------------------------------------------------------------------ *
 * Request ID resolution helper
 * ------------------------------------------------------------------ */

function resolveRequestId(data, request) {
  return (
    data?.ID || request.params?.[request.params.length - 1]?.ID || null
  );
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @After(event = { "UPDATE" }, entity = "ZSVC_PPS_VIREMENT.Requests(draft)")
 *
 * Refreshes the CAP-owned approver preview (see
 * utils/apply-approver-plan.js) whenever a header field it depends on
 * - requestType_code or budgetType_code - is changed directly on the
 * draft, e.g. the user corrects the Request Type after items already
 * exist. Item-driven refreshes (the amount changing) are handled
 * separately in requestitems-drafts-after-create/after-update-logic.js.
 *
 * Only runs when this specific PATCH actually touched one of those
 * two fields, so routine edits (Reason, Cost Centre, etc.) don't pay
 * for an unnecessary lookup.
 *
 * @param {object} data - the updated fields (PATCH payload echo)
 * @param {cds.Request} request
 */
module.exports = async function (data, request) {
  try {
    const patchedFields = request.data || {};

    if (
      !("requestType_code" in patchedFields) &&
      !("budgetType_code" in patchedFields)
    ) {
      return;
    }

    LOG.info("--- AFTER UPDATE Requests.drafts started ---");

    const requestId = resolveRequestId(data, request);

    if (!requestId) {
      LOG.warn("No Request ID found for updated draft; skipping refresh.");
      return;
    }

    const tx = cds.tx(request);

    const { Requests, RequestApprovers, RequestItems } =
      cds.entities(SERVICE_NAMESPACE);

    if ("budgetType_code" in patchedFields) {
      // Cascade the header's new Budget Type onto every existing item
      // (see budgetTypeCode in db/schema.cds) - items created before
      // this PATCH still carry the OLD value otherwise, so the item
      // tables' Cost Centre/GL/Material vs WBS columns would stay on
      // the wrong set until the item itself is touched.
      await tx.run(
        UPDATE(RequestItems.drafts)
          .set({ budgetTypeCode: patchedFields.budgetType_code })
          .where({ request_ID: requestId }),
      );

      LOG.info(
        "Cascaded budgetTypeCode to existing items:",
        JSON.stringify({ requestId, budgetTypeCode: patchedFields.budgetType_code }),
      );
    }

    const applied = await refreshDraftApproverPreview({
      tx,
      RequestsDraft: Requests.drafts,
      RequestApproversDraft: RequestApprovers.drafts,
      requestId,
    });

    LOG.info(
      "Refreshed CAP-owned approver preview after header update:",
      JSON.stringify({ requestId, applied }),
    );

    LOG.info("--- AFTER UPDATE Requests.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Error in requests-drafts-after-update-logic:", error);
    // After-phase failure should not corrupt the update result; log only.
  }
};
