const cds = require("@sap/cds");

const LOG = cds.log("requests-calculation-utils");

/**
 * Calculates all amount fields from a request's items.
 * Each type maintains its own separate amounts - they are NOT summed together.
 *
 * For each request, the following amounts are always calculated:
 *   - supplementAmount (sum of all item.supplementAmount)
 *   - returnAmount (sum of all item.returnAmount)
 *   - transferInAmount (sum of all item.transferInAmount)
 *   - transferOutAmount (sum of all item.transferOutAmount)
 *
 * These are independent totals, not combined into a single totalAmount.
 *
 * @param {object} options
 * @param {object} options.tx - The transaction (cds.tx(request))
 * @param {object} options.RequestItems - The RequestItems entity (with .drafts)
 * @param {string} options.requestId - The parent Request ID
 * @param {object} [options.request] - Optional request, for deep payload fallback
 * @returns {Promise<object>} Object with:
 *   - supplementAmount: sum of all supplementAmount
 *   - returnAmount: sum of all returnAmount
 *   - transferInAmount: sum of all transferInAmount
 *   - transferOutAmount: sum of all transferOutAmount
 */
async function calculateAmountsByType({ tx, RequestItems, requestId, request }) {
  try {
    if (!requestId) {
      LOG.warn("No requestId provided. Returning zeros.");
      return {
        supplementAmount: "0.00",
        returnAmount: "0.00",
        transferInAmount: "0.00",
        transferOutAmount: "0.00"
      };
    }

    let items = [];

    // Try to read from draft items table first
    if (RequestItems?.drafts) {
      items = await tx.run(
        SELECT.from(RequestItems.drafts)
          .columns(
            "supplementAmount",
            "returnAmount",
            "transferInAmount",
            "transferOutAmount"
          )
          .where({ request_ID: requestId })
      );
    }

    // Fallback to deep payload if no items found
    if (
      (!items || items.length === 0) &&
      Array.isArray(request?.data?.RequestItems)
    ) {
      items = request.data.RequestItems;
      LOG.info("Using deep payload RequestItems fallback:", items.length);
    }

    LOG.info("Request items used for calculation:", JSON.stringify(items || []));

    // Initialize accumulators
    let totalSupplementAmount = 0;
    let totalReturnAmount = 0;
    let totalTransferInAmount = 0;
    let totalTransferOutAmount = 0;

    // Sum all amounts from all items
    for (const item of items || []) {
      const supplementAmount = Number(item.supplementAmount || 0);
      const returnAmount = Number(item.returnAmount || 0);
      const transferInAmount = Number(item.transferInAmount || 0);
      const transferOutAmount = Number(item.transferOutAmount || 0);

      // Validate and accumulate
      if (!Number.isNaN(supplementAmount)) {
        totalSupplementAmount += supplementAmount;
      } else if (item.supplementAmount !== null && item.supplementAmount !== undefined) {
        LOG.warn("Invalid supplementAmount on item, skipped:", JSON.stringify(item));
      }

      if (!Number.isNaN(returnAmount)) {
        totalReturnAmount += returnAmount;
      } else if (item.returnAmount !== null && item.returnAmount !== undefined) {
        LOG.warn("Invalid returnAmount on item, skipped:", JSON.stringify(item));
      }

      if (!Number.isNaN(transferInAmount)) {
        totalTransferInAmount += transferInAmount;
      } else if (item.transferInAmount !== null && item.transferInAmount !== undefined) {
        LOG.warn("Invalid transferInAmount on item, skipped:", JSON.stringify(item));
      }

      if (!Number.isNaN(transferOutAmount)) {
        totalTransferOutAmount += transferOutAmount;
      } else if (item.transferOutAmount !== null && item.transferOutAmount !== undefined) {
        LOG.warn("Invalid transferOutAmount on item, skipped:", JSON.stringify(item));
      }
    }

    const result = {
      supplementAmount: Number(totalSupplementAmount).toFixed(2),
      returnAmount: Number(totalReturnAmount).toFixed(2),
      transferInAmount: Number(totalTransferInAmount).toFixed(2),
      transferOutAmount: Number(totalTransferOutAmount).toFixed(2)
    };

    LOG.info("Calculated amounts:", JSON.stringify(result));
    return result;

  } catch (error) {
    LOG.error("Error in calculateAmountsByType:", error);
    throw error;
  }
}

module.exports = {
  calculateAmountsByType
};
