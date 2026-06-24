const cds = require("@sap/cds");

const LOG = cds.log("requestitems-drafts-before-delete-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const SR_NO_LENGTH = 3;

/* ------------------------------------------------------------------ *
 * Key resolution helper
 * ------------------------------------------------------------------ */

function getDeletedItemId(request) {
  const keys = request.params?.[request.params.length - 1];
  return keys?.ID || null;
}

/* ------------------------------------------------------------------ *
 * Resequencing helper
 * ------------------------------------------------------------------ */

async function resequenceSiblings({ tx, ItemsDraft, siblings }) {
  let sequence = 1;
  let updatedCount = 0;

  for (const item of siblings || []) {
    const newSrNo = String(sequence).padStart(SR_NO_LENGTH, "0");

    if (item.srNo !== newSrNo) {
      await tx.run(
        UPDATE(ItemsDraft).set({ srNo: newSrNo }).where({ ID: item.ID }),
      );
      updatedCount++;
    }

    sequence++;
  }

  return updatedCount;
}

/* ------------------------------------------------------------------ *
 * Main handler
 * ------------------------------------------------------------------ */

/**
 * @Before(event = { "DELETE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems(draft)")
 *
 * Before a draft RequestItems row is deleted, captures its parent Request,
 * then resequences the srNo of the REMAINING siblings (excluding the one
 * being deleted) so the sequence has no gaps.
 *
 * NOTE: The parent Request's totalAmount is intentionally NOT recalculated
 * here on delete. Total recalculation is handled elsewhere (e.g. the
 * calculateValues action) so deletes only adjust the srNo sequence.
 *
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE DELETE RequestItems started: resequence srNo ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Request params:", JSON.stringify(request.params || []));

    const tx = cds.tx(request);
    const { RequestItems } = cds.entities(SERVICE_NAMESPACE);
    const ItemsDraft = RequestItems.drafts;

    // 1. Resolve the key of the item being deleted.
    const deletedItemId = getDeletedItemId(request);
    LOG.info("Deleted item ID:", deletedItemId);

    if (!deletedItemId) {
      LOG.warn("No item key in delete request; skipping resequence.");
      return;
    }

    // 2. Read the item being deleted to obtain its parent request_ID.
    const deletedItem = await tx.run(
      SELECT.one
        .from(ItemsDraft)
        .columns("ID", "request_ID")
        .where({ ID: deletedItemId }),
    );

    LOG.info("Deleted item record:", JSON.stringify(deletedItem || {}));

    if (!deletedItem?.request_ID) {
      LOG.warn("Could not resolve parent request_ID; skipping resequence.");
      return;
    }

    const parentRequestId = deletedItem.request_ID;
    LOG.info("Parent request_ID:", parentRequestId);

    // 3. Read the remaining siblings (exclude the one being deleted),
    //    ordered by srNo, then resequence them (001, 002, 003 ...).
    const siblings = await tx.run(
      SELECT.from(ItemsDraft)
        .columns("ID", "srNo")
        .where({ request_ID: parentRequestId, ID: { "!=": deletedItemId } })
        .orderBy("srNo"),
    );

    LOG.info("Remaining sibling count:", siblings?.length || 0);

    const resequenced = await resequenceSiblings({ tx, ItemsDraft, siblings });

    LOG.info(
      "Resequenced sibling items:",
      `${resequenced} updated for request ${parentRequestId}`,
    );

    LOG.info("--- BEFORE DELETE RequestItems ended successfully ---");
  } catch (error) {
    LOG.error("Error in requestitems-drafts-before-delete-logic:", error);
    // Do not block the deletion; resequencing is best-effort.
  }
};
