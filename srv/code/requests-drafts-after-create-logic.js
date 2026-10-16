const cds = require("@sap/cds");
const { refreshDraftApproverPreview } = require("./utils/apply-approver-plan");
const { recalcAmountsByType } = require("./utils/recalc-total-logic");
const deriveItemFields = require("./requestitems-drafts-before-update-logic");

const LOG = cds.log("requests-drafts-after-create-logic");

const DERIVED_ITEM_FIELDS = [
  "wbsDescription",
  "responsibleCostCentre",
  "glGroup",
  "functionalDepartment",
  "glAccountName",
  "assetType",
  "department",
  "region",
  "branch",
  "buildingName",
  "costCentreDescription",
  "materialGroupDescription",
];

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * @After(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.Requests(draft)")
 *
 * A draft created with its items in one deep insert (e.g. Copy Request)
 * does not fire the item-level after-CREATE, so the totals and the
 * approver preview are computed here, once the whole draft exists.
 */
module.exports = async function (data, request) {
  try {
    const requestId = data?.ID;

    if (!requestId) {
      return;
    }

    const tx = cds.tx(request);
    const { Requests, RequestApprovers, RequestItems } =
      cds.entities(SERVICE_NAMESPACE);

    /*
     * Copied items arrive with only their user-entered fields, so the
     * read-only descriptions and routing fields are looked up here,
     * exactly as the item-level before-update logic does on a patch.
     */
    const items = await tx.run(
      SELECT.from(RequestItems.drafts)
        .columns("ID", "costCentre", "glAccount", "material", "wbs")
        .where({ request_ID: requestId }),
    );

    const originalData = request.data;

    try {
      for (const item of items) {
        request.data = {
          glAccount: item.glAccount,
          costCentre: item.costCentre,
          material: item.material,
          wbs: item.wbs,
        };

        await deriveItemFields(request);

        const derived = {};

        DERIVED_ITEM_FIELDS.forEach((field) => {
          if (request.data[field] !== undefined) {
            derived[field] = request.data[field];
          }
        });

        await tx.run(
          UPDATE(RequestItems.drafts).set(derived).where({ ID: item.ID }),
        );
      }
    } finally {
      request.data = originalData;
    }

    const amounts = await recalcAmountsByType(requestId, true);

    await refreshDraftApproverPreview({
      tx,
      RequestsDraft: Requests.drafts,
      RequestApproversDraft: RequestApprovers.drafts,
      requestId,
      amounts,
    });
  } catch (error) {
    LOG.error("Error in requests-drafts-after-create-logic:", error);
  }
};
