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

module.exports = {
  formatLocalDate,
  formatLocalTime,
  getLocalDateParts,
};
