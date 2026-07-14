/**
 * Builds user metadata from the authenticated CAP user.
 *
 * @param {import("@sap/cds/apis/services").User} user
 * @returns {{
 *   emailAddress: string,
 *   fullName: string
 * }}
 */
function buildUserMeta(user) {
    const emailAddress =
        user.attr?.email ||
        user.id ||
        "";

    const givenName =
        user.attr?.givenName ||
        "";

    const familyName =
        user.attr?.familyName ||
        "";

    const fullName =
        `${givenName} ${familyName}`.trim();

    return {
        emailAddress,
        fullName
    };
}

module.exports = {
    buildUserMeta
};