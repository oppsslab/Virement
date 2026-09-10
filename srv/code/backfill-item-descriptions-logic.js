"use strict";

const cds = require("@sap/cds");

const {
  resolveCostCentreDescription,
} = require("./utils/cost-centre-description-lookup");
const { resolveGLAccountName } = require("./utils/gl-account-name-lookup");
const {
  resolveMaterialGroupDescription,
} = require("./utils/material-group-description-lookup");

const LOG = cds.log("backfill-item-descriptions-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";

/**
 * @requires(role = "VR_ADMIN")
 *
 * One-time admin action: backfills costCentreDescription/glAccountName/
 * materialGroupDescription on existing (active, non-draft) RequestItems
 * rows that predate those fields - created or last touched before
 * requestitems-drafts-before-create/update-logic.js started resolving
 * them server-side. Only ever fills a currently-empty field, never
 * overwrites an existing value, and never touches costCentre/glAccount/
 * material themselves.
 *
 * Distinct costCentre/glAccount/material values are resolved once each
 * (not once per row) via an in-memory cache, so the number of S/4 calls
 * this makes is proportional to the number of distinct codes in use
 * across all items, not the number of item rows.
 *
 * @param {cds.Request} request
 * @returns {Promise<{scanned: number, updated: number, failed: number, errors: string[]}>}
 */
module.exports = async function backfillItemDescriptions(request) {
  LOG.info("--- backfillItemDescriptions started ---");

  const tx = cds.tx(request);

  const { RequestItems } = cds.entities(SERVICE_NAMESPACE);

  const allRows = await tx.run(
    SELECT.from(RequestItems).columns(
      "ID",
      "costCentre",
      "costCentreDescription",
      "glAccount",
      "glAccountName",
      "material",
      "materialGroupDescription",
    ),
  );

  const rows = allRows.filter(
    (row) =>
      (row.costCentre && !row.costCentreDescription) ||
      (row.glAccount && !row.glAccountName) ||
      (row.material && !row.materialGroupDescription),
  );

  LOG.info(
    `Scanned ${allRows.length} item row(s), ${rows.length} need backfill.`,
  );

  const costCentreCache = new Map();
  const glAccountCache = new Map();
  const materialCache = new Map();

  async function cachedResolve(cache, key, resolver) {
    if (cache.has(key)) {
      return cache.get(key);
    }

    const value = await resolver(key);

    cache.set(key, value);

    return value;
  }

  let updated = 0;
  let failed = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const patch = {};

      if (row.costCentre && !row.costCentreDescription) {
        const description = await cachedResolve(
          costCentreCache,
          row.costCentre,
          resolveCostCentreDescription,
        );

        if (description) {
          patch.costCentreDescription = description;
        }
      }

      if (row.glAccount && !row.glAccountName) {
        const name = await cachedResolve(
          glAccountCache,
          row.glAccount,
          resolveGLAccountName,
        );

        if (name) {
          patch.glAccountName = name;
        }
      }

      if (row.material && !row.materialGroupDescription) {
        const description = await cachedResolve(
          materialCache,
          row.material,
          resolveMaterialGroupDescription,
        );

        if (description) {
          patch.materialGroupDescription = description;
        }
      }

      if (Object.keys(patch).length) {
        await tx.run(UPDATE(RequestItems).set(patch).where({ ID: row.ID }));

        updated++;
      }
    } catch (error) {
      failed++;
      errors.push(`${row.ID}: ${error.message}`);

      LOG.error(`Failed to backfill item ${row.ID}:`, error);
    }
  }

  LOG.info(
    `--- backfillItemDescriptions finished: ${rows.length} scanned, ` +
      `${updated} updated, ${failed} failed ---`,
  );

  return {
    scanned: rows.length,
    updated,
    failed,
    errors: errors.slice(0, 50),
  };
};
