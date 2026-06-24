const cds = require("@sap/cds");
const { calculateTotalAmount } = require("./requests-calculation-utils");

const LOG = cds.log("recalc-total-logic");

const SERVICE_NAMESPACE = "ZSVC_PPS_VIREMENT";
const SR_NO_LENGTH = 3;

/* ------------------------------------------------------------------ *
 * srNo resequencing helper
 * ------------------------------------------------------------------ */

async function resequenceItems({ tx, ItemsDraft, items }) {
  let sequence = 1;
  let updatedCount = 0;

  for (const item of items || []) {
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
 * Main util
 * ------------------------------------------------------------------ */

/**
 * Recalculates the parent Request's totalAmount from its draft items,
 * and (optionally) resequences the srNo of those items. Operates entirely
 * on the draft entities.
 *
 * @param {object} options
 * @param {object} options.tx - The transaction (cds.tx(request))
 * @param {string} options.requestId - The parent Requests.ID
 * @param {object} [options.request] - Optional request, for deep payload fallback
 * @param {boolean} [options.doResequence=true] - Whether to also resequence srNo
 * @returns {Promise<{ totalAmount: string, resequenced: number }>}
 */
async function recalcRequestTotal({
  tx,
  requestId,
  request,
  doResequence = true,
}) {
  LOG.info("--- recalcRequestTotal started ---");

  if (!requestId) {
    LOG.warn("recalcRequestTotal called without requestId; skipping.");
    return { totalAmount: Number(0).toFixed(2), resequenced: 0 };
  }

  LOG.info("Recalculating for Request ID:", requestId);

  const { Requests, RequestItems } = cds.entities(SERVICE_NAMESPACE);
  const ItemsDraft = RequestItems.drafts;
  const RequestsDraft = Requests.drafts;

  // 1. Resequence srNo of the draft items (close any gaps).
  let resequenced = 0;

  if (doResequence) {
    const items = await tx.run(
      SELECT.from(ItemsDraft)
        .columns("ID", "srNo")
        .where({ request_ID: requestId })
        .orderBy("srNo"),
    );

    LOG.info("Draft items to resequence:", items?.length || 0);

    resequenced = await resequenceItems({ tx, ItemsDraft, items });
    LOG.info("Resequenced srNo count:", resequenced);
  }

  // 2. Recalculate the total amount (reuses the shared calculation util).
  const totalAmount = await calculateTotalAmount({
    tx,
    RequestItems,
    requestId,
    request,
  });

  LOG.info("Recalculated totalAmount:", totalAmount);

  // 3. Write the recalculated total back to the draft Request.
  await tx.run(
    UPDATE(RequestsDraft).set({ totalAmount }).where({ ID: requestId }),
  );

  LOG.info("Updated totalAmount on draft Request:", requestId);
  LOG.info("--- recalcRequestTotal ended successfully ---");

  return { totalAmount, resequenced };
}

module.exports = {
  recalcRequestTotal,
};
