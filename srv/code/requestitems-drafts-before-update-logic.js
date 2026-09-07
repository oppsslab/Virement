const cds = require("@sap/cds");

const { resolveGLGroup } = require("./utils/gl-grouping-lookup");
const { resolveDepartment } = require("./utils/department-grouping-lookup");
const {
  resolveFunctionalDepartment,
} = require("./utils/functional-department-grouping-lookup");
const {
  resolveRegionBranch,
} = require("./utils/region-branch-grouping-lookup");

const LOG = cds.log("requestitems-drafts-before-update-logic");

/**
 * @Before(event = { "UPDATE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems(draft)")
 *
 * Whenever a draft item's GL Account or Cost Centre is patched,
 * auto-populates the corresponding read-only field(s) (see
 * db/schema.cds RequestItems.glGroup / .functionalDepartment /
 * .department / .region / .branch) from GL Grouping / Functional
 * Department Grouping / Department Grouping / Region & Branch
 * Grouping master data, in the same patch - so the requestor never
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

    if (!("glAccount" in patchedFields) && !("costCentre" in patchedFields)) {
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

      LOG.info(
        "Auto-populated glGroup/functionalDepartment for patched glAccount:",
        JSON.stringify({
          glAccount: patchedFields.glAccount,
          glGroup,
          functionalDepartment,
        }),
      );
    }

    if ("costCentre" in patchedFields) {
      const department = await resolveDepartment(tx, patchedFields.costCentre);

      request.data.department = department;

      const { region, branch } = await resolveRegionBranch(
        tx,
        patchedFields.costCentre,
      );

      request.data.region = region;
      request.data.branch = branch;

      LOG.info(
        "Auto-populated department/region/branch for patched costCentre:",
        JSON.stringify({
          costCentre: patchedFields.costCentre,
          department,
          region,
          branch,
        }),
      );
    }
  } catch (error) {
    LOG.error("Error in requestitems-drafts-before-update-logic:", error);
    // Don't block the item update if a lookup fails.
  }
};
