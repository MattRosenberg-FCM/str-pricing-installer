import { describe, it, expect } from 'vitest'
import {
  parsePrice,
  formatPrice,
  roundToNearest10,
  calculateListPrice,
  calculateAdjustedPrice,
  calculateNightlyRates,
  DEFAULT_NIGHTLY_WEIGHTS,
  PLATFORM_COMMISSION_RATES
} from './calculations.js'

describe('Price Parsing and Formatting', () => {
  describe('parsePrice', () => {
    it('should parse dollar amounts with commas', () => {
      expect(parsePrice('$3,000')).toBe(3000)
      expect(parsePrice('$4,142')).toBe(4142)
    })

    it('should parse plain numbers', () => {
      expect(parsePrice('3000')).toBe(3000)
      expect(parsePrice('4142')).toBe(4142)
    })

    it('should handle empty/invalid input', () => {
      expect(parsePrice('')).toBe(0)
      expect(parsePrice(null)).toBe(0)
      expect(parsePrice(undefined)).toBe(0)
    })

    it('should handle number input', () => {
      expect(parsePrice(3000)).toBe(3000)
    })
  })

  describe('formatPrice', () => {
    it('should format numbers with dollar sign and commas', () => {
      expect(formatPrice(3000)).toBe('$3,000')
      expect(formatPrice(4142)).toBe('$4,142')
    })

    it('should handle small numbers', () => {
      expect(formatPrice(100)).toBe('$100')
      expect(formatPrice(0)).toBe('$0')
    })
  })
})

describe('Rounding', () => {
  describe('roundToNearest10', () => {
    it('should round to nearest $10', () => {
      expect(roundToNearest10(3147)).toBe(3150)
      expect(roundToNearest10(3142)).toBe(3140)
      expect(roundToNearest10(3145)).toBe(3150)
    })

    it('should handle already-rounded values', () => {
      expect(roundToNearest10(3000)).toBe(3000)
      expect(roundToNearest10(3150)).toBe(3150)
    })
  })
})

describe('Commission Calculations', () => {
  describe('calculateListPrice', () => {
    it('should calculate Airbnb list price (15.5% commission)', () => {
      // To NET $3,500 at 15.5%: $3,500 / 0.845 = $4,142.01... rounds UP to $4,143
      expect(calculateListPrice(3500, 0.155)).toBe(4143)
    })

    it('should calculate Vrbo list price (8% commission)', () => {
      // To NET $3,000 at 8%: $3,000 / 0.92 = $3,260.87... rounds UP to $3,261
      expect(calculateListPrice(3000, 0.08)).toBe(3261)
    })

    it('should handle WNAV (0% commission)', () => {
      expect(calculateListPrice(3000, 0)).toBe(3000)
      expect(calculateListPrice(3500, 0)).toBe(3500)
    })

    it('should always round UP', () => {
      // Even $0.01 over should round up
      const netPrice = 3000
      const listPrice = calculateListPrice(netPrice, 0.15) // 3000 / 0.85 = 3529.41...
      expect(listPrice).toBe(3530) // Rounds UP
    })

    it('should handle edge case of 100% commission', () => {
      expect(calculateListPrice(3000, 1)).toBe(3000)
      expect(calculateListPrice(3000, 1.5)).toBe(3000)
    })
  })
})

describe('Season Adjustments', () => {
  describe('calculateAdjustedPrice', () => {
    it('should calculate positive percentage adjustments', () => {
      expect(calculateAdjustedPrice(3000, 10)).toBe(3300) // +10%
      expect(calculateAdjustedPrice(3000, 25)).toBe(3750) // +25%
    })

    it('should calculate negative percentage adjustments', () => {
      expect(calculateAdjustedPrice(3000, -15)).toBe(2550) // -15%
      expect(calculateAdjustedPrice(3000, -20)).toBe(2400) // -20%
    })

    it('should round to nearest $10', () => {
      // 3000 * 1.12 = 3360 (already at $10)
      expect(calculateAdjustedPrice(3000, 12)).toBe(3360)

      // 3000 * 1.13 = 3390 (already at $10)
      expect(calculateAdjustedPrice(3000, 13)).toBe(3390)
    })

    it('should handle zero adjustment', () => {
      expect(calculateAdjustedPrice(3000, 0)).toBe(3000)
    })
  })
})

describe('Nightly Rate Distribution', () => {
  describe('calculateNightlyRates', () => {
    it('should distribute $3,000 using default weights', () => {
      const rates = calculateNightlyRates(3000, DEFAULT_NIGHTLY_WEIGHTS)

      // Expected with default weights (10,10,10,13,22,23,12):
      expect(rates.monday).toBe(300)    // 3000 * 0.10 = 300
      expect(rates.tuesday).toBe(300)   // 3000 * 0.10 = 300
      expect(rates.wednesday).toBe(300) // 3000 * 0.10 = 300
      expect(rates.thursday).toBe(390)  // 3000 * 0.13 = 390
      expect(rates.friday).toBe(660)    // 3000 * 0.22 = 660
      expect(rates.saturday).toBe(690)  // 3000 * 0.23 = 690
      expect(rates.sunday).toBe(360)    // 3000 * 0.12 = 360
    })

    it('should round each night UP', () => {
      // Use a weekly rate that creates fractional cents
      const rates = calculateNightlyRates(1000, DEFAULT_NIGHTLY_WEIGHTS)

      // 1000 * 0.10 = 100 (exact)
      expect(rates.monday).toBe(100)

      // 1000 * 0.13 = 130 (exact)
      expect(rates.thursday).toBe(130)

      // 1000 * 0.22 = 220 (exact)
      expect(rates.friday).toBe(220)
    })

    it('should work with custom weights', () => {
      const customWeights = {
        monday: 5,
        tuesday: 5,
        wednesday: 5,
        thursday: 5,
        friday: 30,
        saturday: 40,
        sunday: 10
      }

      const rates = calculateNightlyRates(2000, customWeights)

      expect(rates.monday).toBe(100)    // 2000 * 0.05 = 100
      expect(rates.friday).toBe(600)    // 2000 * 0.30 = 600
      expect(rates.saturday).toBe(800)  // 2000 * 0.40 = 800
    })

    it('should have all 7 days in output', () => {
      const rates = calculateNightlyRates(3000, DEFAULT_NIGHTLY_WEIGHTS)
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

      days.forEach(day => {
        expect(rates).toHaveProperty(day)
        expect(typeof rates[day]).toBe('number')
      })
    })
  })
})

describe('Constants', () => {
  describe('DEFAULT_NIGHTLY_WEIGHTS', () => {
    it('should total 100%', () => {
      const total = Object.values(DEFAULT_NIGHTLY_WEIGHTS).reduce((sum, val) => sum + val, 0)
      expect(total).toBe(100)
    })

    it('should have all 7 days', () => {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      days.forEach(day => {
        expect(DEFAULT_NIGHTLY_WEIGHTS).toHaveProperty(day)
      })
    })

    it('should match documented values', () => {
      expect(DEFAULT_NIGHTLY_WEIGHTS.monday).toBe(10)
      expect(DEFAULT_NIGHTLY_WEIGHTS.tuesday).toBe(10)
      expect(DEFAULT_NIGHTLY_WEIGHTS.wednesday).toBe(10)
      expect(DEFAULT_NIGHTLY_WEIGHTS.thursday).toBe(13)
      expect(DEFAULT_NIGHTLY_WEIGHTS.friday).toBe(22)
      expect(DEFAULT_NIGHTLY_WEIGHTS.saturday).toBe(23)
      expect(DEFAULT_NIGHTLY_WEIGHTS.sunday).toBe(12)
    })
  })

  describe('PLATFORM_COMMISSION_RATES', () => {
    it('should have correct rates', () => {
      expect(PLATFORM_COMMISSION_RATES.wnav).toBe(0)       // 0%
      expect(PLATFORM_COMMISSION_RATES.airbnb).toBe(0.155) // 15.5%
      expect(PLATFORM_COMMISSION_RATES.vrbo).toBe(0.08)    // 8%
    })
  })
})
