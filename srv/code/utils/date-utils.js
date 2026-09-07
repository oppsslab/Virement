/**
 * Date/time formatting helpers shared across handlers.
 *
 * "Local" here means Malaysia time (UTC+8) - the business's own
 * timezone - not the server process's OS timezone. Cloud Foundry
 * containers run in UTC, so using Date's own local getters
 * (getFullYear/getHours/setHours/...) would silently compute UTC
 * wall-clock values instead: correct during Malaysia's daytime, but
 * a full calendar day behind for anything submitted between Malaysia
 * midnight and 7:59am (UTC hasn't rolled over to the new date yet).
 * Confirmed live: RequestHistory.date/.time (plain Date/Time, no
 * timezone info for the client to convert) showed exactly 8 hours
 * behind genuinely UTC-aware fields like the workflow log timestamps
 * and RequestApprovers.actionDate, which the client DOES correctly
 * convert from UTC since they carry an explicit offset.
 *
 * Every function below converts explicitly via the UTC epoch, so the
 * result is correct regardless of the server process's own timezone.
 */

const MALAYSIA_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Shifts a Date by Malaysia's UTC+8 offset, so its own UTC getters
 * (getUTCFullYear, getUTCHours, ...) read back Malaysia wall-clock
 * values instead of the server process's local time.
 *
 * @param {Date} date
 * @returns {Date}
 */
function toMalaysiaTime(date) {
  return new Date(date.getTime() + MALAYSIA_UTC_OFFSET_MS);
}

/**
 * Formats a date as YYYY-MM-DD (Malaysia local time).
 * @param {Date} [date]
 * @returns {string}
 */
function formatLocalDate(date = new Date()) {
  const malaysiaTime = toMalaysiaTime(date);
  const year = malaysiaTime.getUTCFullYear();
  const month = String(malaysiaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(malaysiaTime.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a time as HH:MM:SS (Malaysia local time).
 * @param {Date} [date]
 * @returns {string}
 */
function formatLocalTime(date = new Date()) {
  const malaysiaTime = toMalaysiaTime(date);
  const hours = String(malaysiaTime.getUTCHours()).padStart(2, "0");
  const minutes = String(malaysiaTime.getUTCMinutes()).padStart(2, "0");
  const seconds = String(malaysiaTime.getUTCSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Returns common Malaysia local date parts.
 * @param {Date} [date]
 */
function getLocalDateParts(date = new Date()) {
  const malaysiaTime = toMalaysiaTime(date);
  const year = malaysiaTime.getUTCFullYear();
  const month = String(malaysiaTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(malaysiaTime.getUTCDate()).padStart(2, "0");

  return {
    year,
    month,
    day,
    dateString: `${year}-${month}-${day}`,
    period: month,
  };
}

/**
 * Calculates whole calendar days elapsed between two dates, in
 * Malaysia local time.
 *
 * Both dates are normalized to Malaysia midnight first, so the
 * result counts date boundaries crossed rather than elapsed hours.
 * Calendar days: weekends and public holidays are included.
 *
 * @param {string|Date} fromDate
 * @param {string|Date} [toDate] - defaults to now
 * @returns {number} whole days, never negative; 0 if either date is unusable
 */
function calculateDaysSince(fromDate, toDate = new Date()) {
  if (!fromDate) {
    return 0;
  }

  const from = new Date(fromDate);
  const to = new Date(toDate);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 0;
  }

  const fromMalaysiaMidnight = toMalaysiaTime(from);
  fromMalaysiaMidnight.setUTCHours(0, 0, 0, 0);

  const toMalaysiaMidnight = toMalaysiaTime(to);
  toMalaysiaMidnight.setUTCHours(0, 0, 0, 0);

  const millisecondsPerDay = 86400000;

  return Math.max(
    0,
    Math.floor(
      (toMalaysiaMidnight.getTime() - fromMalaysiaMidnight.getTime()) /
        millisecondsPerDay,
    ),
  );
}

module.exports = {
  calculateDaysSince,
  formatLocalDate,
  formatLocalTime,
  getLocalDateParts,
};
