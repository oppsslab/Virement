/**
 * Date/time formatting helpers shared across handlers.
 */

/**
 * Formats a date as YYYY-MM-DD (local time).
 * @param {Date} [date]
 * @returns {string}
 */
function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formats a time as HH:MM:SS (local time).
 * @param {Date} [date]
 * @returns {string}
 */
function formatLocalTime(date = new Date()) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Returns common local date parts.
 * @param {Date} [date]
 */
function getLocalDateParts(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return {
    year,
    month,
    day,
    dateString: `${year}-${month}-${day}`,
    period: month,
  };
}

/**
 * Calculates whole calendar days elapsed between two dates.
 *
 * Both dates are normalized to midnight first, so the result counts
 * date boundaries crossed rather than elapsed hours. Calendar days:
 * weekends and public holidays are included.
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

  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);

  const millisecondsPerDay = 86400000;

  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / millisecondsPerDay));
}

module.exports = {
  calculateDaysSince,
  formatLocalDate,
  formatLocalTime,
  getLocalDateParts,
};
