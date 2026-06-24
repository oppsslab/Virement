const cds = require("@sap/cds");

const LOG = cds.log("requests-calculation-utils");

/**
 * Calculates the total amount from a request's items.
 *
 * Reads from the drafts table (where items live during edit/submit),
 * with a fallback to the deep payload (nested RequestItems in request.data).
 *
 * @param {object} options
 * @param {object} options.tx - The transaction (cds.tx(request))
 * @param {object} options.RequestItems - The RequestItems entity (with .drafts)
 * @param {string} options.requestId - The parent Request ID
 * @param {object} [options.request] - Optional request, for deep payload fallback
 * @returns {Promise<string>} totalAmount as a fixed-2 decimal string (e.g. "8000.00")
 */
async function calculateTotalAmount({ tx, RequestItems, requestId, request }) {
  try {
    if (!requestId) {
      LOG.warn("No requestId provided. Returning 0.00.");
      return Number(0).toFixed(2);
    }

    let items = [];

    if (RequestItems?.drafts) {
      items = await tx.run(
        SELECT.from(RequestItems.drafts)
          .columns("amount")
          .where({ request_ID: requestId }),
      );
    }

    if (
      (!items || items.length === 0) &&
      Array.isArray(request?.data?.RequestItems)
    ) {
      items = request.data.RequestItems;
      LOG.info("Using deep payload RequestItems fallback:", items.length);
    }

    LOG.info("Request items used for total:", JSON.stringify(items || []));

    let totalAmount = 0;

    for (const item of items || []) {
      const amount = Number(item.amount || 0);

      if (!Number.isNaN(amount)) {
        totalAmount += amount;
      } else {
        LOG.warn("Invalid amount on item, skipped:", JSON.stringify(item));
      }
    }

    const result = Number(totalAmount).toFixed(2);
    LOG.info("Calculated totalAmount:", result);

    return result;
  } catch (error) {
    LOG.error("Error in calculateTotalAmount:", error);
    throw error;
  }
}

module.exports = {
  calculateTotalAmount,
};
