const {
  resolveGLGroup,
  resolveAssetType,
} = require("./gl-grouping-lookup");
const { resolveDepartment } = require("./department-grouping-lookup");
const { resolveRegionBranch } = require("./region-branch-grouping-lookup");
const {
  resolveFunctionalDepartment,
} = require("./functional-department-grouping-lookup");
const { resolveBuildingName } = require("./building-grouping-lookup");
const {
  resolveCostCentreDescription,
} = require("./cost-centre-description-lookup");
const { resolveGLAccountName } = require("./gl-account-name-lookup");
const {
  resolveMaterialGroupDescription,
} = require("./material-group-description-lookup");
const { resolveWBSDetails } = require("./wbs-elements");

/*
 * Without a cache every call resolves straight away. With one (the
 * bulk upload passes a Map shared across all rows), identical lookups
 * - the same GL account, cost centre, material, WBS repeated across
 * rows - run once instead of once per row, so a large upload does not
 * multiply database and S/4 round trips.
 */
function memo(cache, key, fn) {
  if (!cache) {
    return fn();
  }

  if (!cache.has(key)) {
    cache.set(key, fn());
  }

  return cache.get(key);
}

/**
 * Fills the read-only derived fields on a RequestItems draft row from
 * its GL Account / WBS / Cost Centre / Material. Client-provided values
 * for these fields are always overwritten.
 *
 * @param {object} tx
 * @param {object} data - the item row; mutated in place
 * @param {Map} [cache]
 * @returns {Promise<object>} the same data object
 */
async function enrichItemData(tx, data, cache) {
  if (data.glAccount) {
    const gl = data.glAccount;

    data.glGroup = await memo(cache, `glGroup:${gl}`, () =>
      resolveGLGroup(tx, gl),
    );
    data.functionalDepartment = await memo(cache, `funcDept:${gl}`, () =>
      resolveFunctionalDepartment(tx, gl),
    );
    data.glAccountName = await memo(cache, `glName:${gl}`, () =>
      resolveGLAccountName(gl),
    );
    data.assetType = await memo(cache, `assetType:${gl}`, () =>
      resolveAssetType(tx, gl),
    );
  }

  if (data.wbs) {
    const wbs = data.wbs;
    const wbsDetails = await memo(cache, `wbs:${wbs}`, () =>
      resolveWBSDetails(wbs),
    );

    data.wbsDescription = wbsDetails.wbsDescription;
    data.responsibleCostCentre = wbsDetails.responsibleCostCenter;
  }

  if (data.costCentre) {
    const cc = data.costCentre;

    data.department = await memo(cache, `dept:${cc}`, () =>
      resolveDepartment(tx, cc),
    );

    const { region, branch } = await memo(cache, `regionBranch:${cc}`, () =>
      resolveRegionBranch(tx, cc),
    );

    data.region = region;
    data.branch = branch;

    data.buildingName = await memo(cache, `building:${cc}`, () =>
      resolveBuildingName(tx, cc),
    );
    data.costCentreDescription = await memo(cache, `ccDesc:${cc}`, () =>
      resolveCostCentreDescription(cc),
    );
  }

  if (data.material) {
    const material = data.material;

    data.materialGroupDescription = await memo(
      cache,
      `matDesc:${material}`,
      () => resolveMaterialGroupDescription(material),
    );
  }

  return data;
}

module.exports = { enrichItemData };
