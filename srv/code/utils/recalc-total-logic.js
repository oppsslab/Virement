const cds = require("@sap/cds");

const LOG = cds.log("recalc-total-logic");

/**
 * Recalculates the parent Request's amount fields from its draft items,
 * and optionally resequences srNo.
 *
 * Calculates independent sums (NOT combined into totalAmount):
 *   - supplementAmount (sum of all item.supplementAmount)
 *   - returnAmount (sum of all item.returnAmount)
 *   - transferInAmount (sum of all item.transferInAmount)
 *   - transferOutAmount (sum of all item.transferOutAmount)
 *
 * @param {string} requestId - the parent Requests.ID
 * @param {boolean} [doResequence=true] - whether to also resequence srNo
 * @returns {Promise<object>} Object with calculated amounts
 */
async function recalcAmountsByType(requestId, doResequence = true) {
  if (!requestId) {
    LOG.warn("recalcAmountsByType called without requestId.");
    return {
      supplementAmount: "0.00",
      returnAmount: "0.00",
      transferInAmount: "0.00",
      transferOutAmount: "0.00"
    };
  }

  const { Requests, RequestItems } = cds.entities("ZSVC_PPS_VIREMENT");
  const ItemsDraft = RequestItems.drafts;
  const RequestsDraft = Requests.drafts;

  // Read all draft items for this request, ordered by srNo.
  const items = await SELECT.from(ItemsDraft)
    .columns(
      "ID",
      "srNo",
      "supplementAmount",
      "returnAmount",
      "transferInAmount",
      "transferOutAmount"
    )
    .where({ request_ID: requestId })
    .orderBy("srNo");

  LOG.info(`Recalc for request ${requestId}, items=${items.length}`);

  // Initialize accumulators
  let totalSupplementAmount = 0;
  let totalReturnAmount = 0;
  let totalTransferInAmount = 0;
  let totalTransferOutAmount = 0;
  let seq = 1;

  // Process each item
  for (const item of items) {
    // Accumulate amounts
    totalSupplementAmount += Number(item.supplementAmount) || 0;
    totalReturnAmount += Number(item.returnAmount) || 0;
    totalTransferInAmount += Number(item.transferInAmount) || 0;
    totalTransferOutAmount += Number(item.transferOutAmount) || 0;

    // Optionally resequence srNo (close gaps)
    if (doResequence) {
      const newSr = String(seq).padStart(3, "0");
      if (item.srNo !== newSr) {
        await UPDATE(ItemsDraft)
          .set({ srNo: newSr })
          .where({ ID: item.ID });
      }
      seq++;
    }
  }

  // Write all calculated amounts back to the DRAFT request
  await UPDATE(RequestsDraft)
    .set({
      supplementAmount: Number(totalSupplementAmount).toFixed(2),
      returnAmount: Number(totalReturnAmount).toFixed(2),
      transferInAmount: Number(totalTransferInAmount).toFixed(2),
      transferOutAmount: Number(totalTransferOutAmount).toFixed(2)
    })
    .where({ ID: requestId });

  const result = {
    supplementAmount: Number(totalSupplementAmount).toFixed(2),
    returnAmount: Number(totalReturnAmount).toFixed(2),
    transferInAmount: Number(totalTransferInAmount).toFixed(2),
    transferOutAmount: Number(totalTransferOutAmount).toFixed(2)
  };

  LOG.info(`Recalc complete: ${JSON.stringify(result)}`);
  return result;
}

module.exports = {
  recalcAmountsByType
};
