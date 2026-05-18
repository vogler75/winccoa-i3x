'use strict';

/**
 * Map WinCC OA quality indicators to i3X quality strings.
 *
 * i3X v1 quality values: "Good", "GoodNoData", "Bad", "Uncertain"
 */

/**
 * @param {boolean|null|undefined} invalid  Value of _online.._invalid
 * @param {boolean} [noValue]               True when no value exists at all
 * @returns {string} i3X quality string
 */
function mapQuality(invalid, noValue) {
  if (noValue) return 'GoodNoData';
  if (invalid === true) return 'Bad';
  if (invalid === false) return 'Good';
  return 'Uncertain';
}

module.exports = { mapQuality };
