/**
 * Business Logic Calculations
 *
 * CRITICAL BUSINESS RULES (from CLAUDE.md):
 *
 * 1. Nightly Rate Distribution - Weekly rate distributes across 7 nights using default weights:
 *    Monday: 10%, Tuesday: 10%, Wednesday: 10%, Thursday: 13%
 *    Friday: 22%, Saturday: 23%, Sunday: 12% (Total: 100%)
 *    Each night rounds UP to next whole dollar
 *
 * 2. Commission Grossup Formula:
 *    List Price = Target NET / (1 - commission rate)
 *    Always round UP to next whole dollar
 *    Example: To NET $3,500 on Airbnb (15.5%): $3,500 / 0.845 = $4,142
 *
 * 3. Rounding Rules:
 *    ALL prices round UP to next whole dollar
 *    $4,141.01 becomes $4,142
 *    $3,000.00 stays $3,000
 *    Never round down
 */

// ============ CONSTANTS ============

/**
 * Default nightly rate distribution weights (must total 100%)
 * User can customize these in settings, but weights must always total exactly 100%
 */
export const DEFAULT_NIGHTLY_WEIGHTS = {
  monday: 10,
  tuesday: 10,
  wednesday: 10,
  thursday: 13,
  friday: 22,
  saturday: 23,
  sunday: 12
}

/**
 * Default platform commission rates
 * User can customize these in settings
 */
export const PLATFORM_COMMISSION_RATES = {
  wnav: 0,        // WeNeedAVacation - owner keeps everything
  airbnb: 0.155,  // 15.5% - standard host-only fee (as of Oct 2025)
  vrbo: 0.08      // 8% - Pay-Per-Booking (5% commission + 3% processing)
}

// ============ PRICE PARSING & FORMATTING ============

/**
 * Parse price string to number
 * Handles formats: "$3,000", "3000", "$3000.00"
 * Returns 0 for invalid input
 *
 * @param {string|number} priceStr - Price string to parse
 * @returns {number} Parsed price as integer
 *
 * @example
 * parsePrice("$3,000") // 3000
 * parsePrice("3000") // 3000
 * parsePrice("") // 0
 */
export function parsePrice(priceStr) {
  if (!priceStr) return 0
  return parseInt(String(priceStr).replace(/[$,]/g, '')) || 0
}

/**
 * Format number as price string
 * Always includes $ symbol and thousands separator
 *
 * @param {number} num - Number to format
 * @returns {string} Formatted price string
 *
 * @example
 * formatPrice(3000) // "$3,000"
 * formatPrice(4142) // "$4,142"
 */
export function formatPrice(num) {
  return `$${num.toLocaleString()}`
}

// ============ ROUNDING ============

/**
 * Round price to nearest $10
 * Used for season adjustments to keep prices clean
 *
 * @param {number} price - Price to round
 * @returns {number} Price rounded to nearest $10
 *
 * @example
 * roundToNearest10(3147) // 3150
 * roundToNearest10(3142) // 3140
 */
export function roundToNearest10(price) {
  return Math.round(price / 10) * 10
}

// ============ COMMISSION CALCULATIONS ============

/**
 * Calculate list price from net price and commission rate (GROSSUP formula)
 *
 * CRITICAL: Always rounds UP to next whole dollar (Math.ceil)
 * Formula: List Price = Target NET / (1 - commission rate)
 *
 * @param {number} netPrice - Target NET amount owner wants to receive
 * @param {number} commissionRate - Commission rate as decimal (0.155 for 15.5%)
 * @returns {number} List price rounded UP to next dollar
 *
 * @example
 * calculateListPrice(3500, 0.155) // 4142 (Airbnb 15.5%)
 * calculateListPrice(3000, 0.08)  // 3261 (Vrbo 8%)
 * calculateListPrice(3000, 0)     // 3000 (WNAV 0%)
 */
export function calculateListPrice(netPrice, commissionRate) {
  if (commissionRate >= 1) return netPrice
  const listPrice = netPrice / (1 - commissionRate)
  return Math.ceil(listPrice) // Round UP
}

// ============ SEASON ADJUSTMENTS ============

/**
 * Calculate adjusted price from base price and percentage change
 * Rounds to nearest $10 to keep prices clean
 *
 * @param {number} basePrice - Base weekly rate
 * @param {number} percentage - Adjustment percentage (10 for +10%, -15 for -15%)
 * @returns {number} Adjusted price rounded to nearest $10
 *
 * @example
 * calculateAdjustedPrice(3000, 10)  // 3300 (+10%)
 * calculateAdjustedPrice(3000, -15) // 2550 (-15%)
 */
export function calculateAdjustedPrice(basePrice, percentage) {
  const adjusted = basePrice * (1 + percentage / 100)
  return roundToNearest10(adjusted)
}

// ============ NIGHTLY RATE DISTRIBUTION ============

/**
 * Distribute weekly rate across 7 nights using weight percentages
 *
 * CRITICAL: Each night rounds UP to next whole dollar (Math.ceil)
 * This means the sum of nightly rates may exceed the weekly rate slightly
 *
 * @param {number} weeklyRate - Total weekly rate to distribute
 * @param {Object} weights - Nightly weight percentages (must total 100%)
 * @param {number} weights.monday - Monday weight %
 * @param {number} weights.tuesday - Tuesday weight %
 * @param {number} weights.wednesday - Wednesday weight %
 * @param {number} weights.thursday - Thursday weight %
 * @param {number} weights.friday - Friday weight %
 * @param {number} weights.saturday - Saturday weight %
 * @param {number} weights.sunday - Sunday weight %
 * @returns {Object} Object with nightly rates for each day
 *
 * @example
 * // Using default weights (10,10,10,13,22,23,12):
 * calculateNightlyRates(3000, DEFAULT_NIGHTLY_WEIGHTS)
 * // Returns: {
 * //   monday: 300,
 * //   tuesday: 300,
 * //   wednesday: 300,
 * //   thursday: 390,
 * //   friday: 660,
 * //   saturday: 690,
 * //   sunday: 360
 * // }
 */
export function calculateNightlyRates(weeklyRate, weights) {
  const rates = {}
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  days.forEach(day => {
    rates[day] = Math.ceil(weeklyRate * (weights[day] / 100))
  })
  return rates
}
