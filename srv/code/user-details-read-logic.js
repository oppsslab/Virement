const cds = require("@sap/cds");
const { buildUserMeta } = require("./utils/user-meta");

const LOG = cds.log("virement-user-details-read-logic");

module.exports = async function (request) {
    LOG.info("=== ON READ UserDetails started ===");

    const emailAddress =
        request.user.attr?.email ||
        request.user.id ||
        "";

    try {
        LOG.info(`Building user details for: ${emailAddress}`);

        const userMeta = buildUserMeta(request.user);

        const userDetails = {
            emailAddress: userMeta.emailAddress,
            fullName: userMeta.fullName
        };

        LOG.info(
            `Successfully generated user details for: ${emailAddress}`
        );

        LOG.info("=== ON READ UserDetails ended successfully ===");

        return userDetails;
    } catch (error) {
        LOG.error({
            message: "Error while generating user details",
            user: emailAddress,
            errorMessage: error.message,
            stack: error.stack
        });

        return request.reject(
            400,
            "Could not retrieve user details."
        );
    }
};