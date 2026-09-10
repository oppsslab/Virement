"use strict";

/**
 * Normalizes a user identity (email) for comparison - requestor,
 * RequestApprovers.emailAddress, and the logged-in user's ID are all
 * the same email-shaped identity, but comparisons must not be
 * sensitive to case or incidental whitespace.
 *
 * @param {*} value
 * @returns {string}
 */
function normalizeUserId(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

module.exports = { normalizeUserId };
