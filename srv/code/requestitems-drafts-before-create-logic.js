const cds = require("@sap/cds");

const LOG = cds.log("requestitems-drafts-before-create-logic");

const SR_NO_PAD_LENGTH = 3;

function resolveParentRequestId(request) {
  return (
    request.data?.request_ID ||
    request.params?.[0]?.request_ID ||
    request.params?.[0]?.ID
  );
}

function getMaxSrNo(items) {
  let maxSrNo = 0;

  for (const item of items || []) {
    const number = parseInt(item.srNo, 10);
    if (!Number.isNaN(number) && number > maxSrNo) {
      maxSrNo = number;
    }
  }

  return maxSrNo;
}

/**
 * @Before(event = { "CREATE" }, entity = "ZSVC_PPS_VIREMENT.RequestItems")
 * @param {cds.Request} request
 */
module.exports = async function (request) {
  LOG.info("--- BEFORE CREATE RequestItems.drafts started ---");

  try {
    LOG.info("Event:", request.event);
    LOG.info("Target:", request.target?.name);
    LOG.info("Incoming request.data:", JSON.stringify(request.data || {}));
    LOG.info("Request params:", JSON.stringify(request.params || []));

    request.data = request.data || {};

    const tx = cds.tx(request);

    const parentRequestId = resolveParentRequestId(request);
    LOG.info("Resolved parent request_ID:", parentRequestId);

    if (!parentRequestId) {
      LOG.error("Unable to determine parent Request ID.");
      return request.error(400, "Unable to determine parent Request ID.");
    }

    if (request.data.srNo) {
      LOG.info(
        "srNo already provided. Skipping generation:",
        request.data.srNo,
      );
      LOG.info(
        "--- BEFORE CREATE RequestItems.drafts ended (existing srNo) ---",
      );
      return;
    }

    const existingItems = await tx.run(
      SELECT.from(request.target)
        .columns("srNo")
        .where({ request_ID: parentRequestId }),
    );

    LOG.info("Existing items count:", existingItems?.length);

    const maxSrNo = getMaxSrNo(existingItems);
    const nextSrNo = String(maxSrNo + 1).padStart(SR_NO_PAD_LENGTH, "0");

    request.data.srNo = nextSrNo;

    LOG.info("Assigned srNo:", nextSrNo);
    LOG.info("--- BEFORE CREATE RequestItems.drafts ended successfully ---");
  } catch (error) {
    LOG.error("Unexpected error in RequestItems srNo logic.", error);
    request.error(500, "An unexpected error occurred while generating SR No.");
  }
};
