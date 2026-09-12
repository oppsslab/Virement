const cds = require("@sap/cds");

const {
  resolveGLGroup,
  resolveAssetType,
} = require("./utils/gl-grouping-lookup");
const { resolveDepartment } = require("./utils/department-grouping-lookup");
const {
  resolveFunctionalDepartment,
} = require("./utils/functional-department-grouping-lookup");
const {
  resolveRegionBranch,
} = require("./utils/region-branch-grouping-lookup");
const { resolveBuildingName } = require("./utils/building-grouping-lookup");
const {
  resolveCostCentreDescription,
} = require("./utils/cost-centre-description-lookup");
const { resolveGLAccountName } = require("./utils/gl-account-name-lookup");
const {
  resolveMaterialGroupDescription,
} = require("./utils/material-group-description-lookup");
const { resolveWBSDetails } = require("./utils/wbs-elements");

const LOG = cds.log("requestitems-drafts-before-update-logic");

/**
 * @Before(event = { "UPDATE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems(draft)")
 *
 * Whenever a draft item's GL Account or Cost Centre is patched,
 * auto-populates the corresponding read-only field(s) (see
 * db/schema.cds RequestItems.glGroup / .functionalDepartment /
 * .glAccountName / .department / .region / .branch / .buildingName /
 * .costCentreDescription / .materialGroupDescription) from GL
 * Grouping / Functional Department Grouping / GL Account search help
 * / Department Grouping / Region & Branch Grouping / Building
 * Grouping / Cost Centre search help / Material Group search help, in
 * the same patch - so the requestor never
 * has to (and, since all these fields are @readonly, cannot) set
 * them directly. Clearing the source field clears the derived one(s)
 * along with it.
 *
 * Each lookup only runs when this specific PATCH actually touched its
 * own source field, so routine edits to other fields (Material,
 * Amount, ...) don't pay for an unnecessary lookup.
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  try {
    const patchedFields = request.data || {};

    if (
      !("glAccount" in patchedFields) &&
      !("costCentre" in patchedFields) &&
      !("material" in patchedFields) &&
      !("wbs" in patchedFields)
    ) {
      return;
    }

    const tx = cds.tx(request);

    if ("glAccount" in patchedFields) {
      const glGroup = await resolveGLGroup(tx, patchedFields.glAccount);

      request.data.glGroup = glGroup;

      const functionalDepartment = await resolveFunctionalDepartment(
        tx,
        patchedFields.glAccount,
      );

      request.data.functionalDepartment = functionalDepartment;

      const glAccountName = await resolveGLAccountName(patchedFields.glAccount);

      request.data.glAccountName = glAccountName;

      const assetType = await resolveAssetType(tx, patchedFields.glAccount);

      request.data.assetType = assetType;

      LOG.info(
        "Auto-populated glGroup/functionalDepartment/glAccountName/assetType for patched glAccount:",
        JSON.stringify({
          glAccount: patchedFields.glAccount,
          glGroup,
          functionalDepartment,
          glAccountName,
          assetType,
        }),
      );
    }

    if ("wbs" in patchedFields) {
      const wbsDetails = await resolveWBSDetails(patchedFields.wbs);

      request.data.wbsDescription = wbsDetails.wbsDescription;

      /*
       * responsibleCostCentre is a dedicated field, separate from
       * costCentre - see db/schema.cds - used only for Virement +
       * Project approval routing (utils/virement-scenario.js
       * classifyVirementProjectScenario). A Project item's costCentre
       * is intentionally left untouched here: the Department/Region/
       * etc. cascade below is a Non Project-only concept that doesn't
       * apply to WBS-based items.
       */
      request.data.responsibleCostCentre = wbsDetails.responsibleCostCenter;

      LOG.info(
        "Auto-populated wbsDescription/responsibleCostCentre for patched wbs:",
        JSON.stringify({
          wbs: patchedFields.wbs,
          wbsDescription: wbsDetails.wbsDescription,
          responsibleCostCentre: request.data.responsibleCostCentre,
        }),
      );
    }

    if ("costCentre" in patchedFields) {
      const costCentre = request.data.costCentre;

      const department = await resolveDepartment(tx, costCentre);

      request.data.department = department;

      const { region, branch } = await resolveRegionBranch(tx, costCentre);

      request.data.region = region;
      request.data.branch = branch;

      const buildingName = await resolveBuildingName(tx, costCentre);

      request.data.buildingName = buildingName;

      const costCentreDescription = await resolveCostCentreDescription(
        costCentre,
      );

      request.data.costCentreDescription = costCentreDescription;

      LOG.info(
        "Auto-populated department/region/branch/buildingName/costCentreDescription for patched costCentre:",
        JSON.stringify({
          costCentre,
          department,
          region,
          branch,
          buildingName,
          costCentreDescription,
        }),
      );
    }

    if ("material" in patchedFields) {
      const materialGroupDescription = await resolveMaterialGroupDescription(
        patchedFields.material,
      );

      request.data.materialGroupDescription = materialGroupDescription;

      LOG.info(
        "Auto-populated materialGroupDescription for patched material:",
        JSON.stringify({
          material: patchedFields.material,
          materialGroupDescription,
        }),
      );
    }

  } catch (error) {
    LOG.error("Error in requestitems-drafts-before-update-logic:", error);
    // Don't block the item update if a lookup fails.
  }
};
