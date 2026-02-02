import { describe, it, expect } from 'vitest'
import {
  getHolidaysForYear,
  getWeekContainingDate,
  formatDateShort,
  formatWeekRange,
  getWeekHolidayRelationship,
  weekKey,
  parseWeekKey
} from './holidays.js'

describe('Holiday Calculations', () => {
  describe('getHolidaysForYear', () => {
    describe('2026 holidays', () => {
      const holidays2026 = getHolidaysForYear(2026)

      it('should return all 6 standard holidays', () => {
        expect(holidays2026).toHaveProperty('newYearsDay')
        expect(holidays2026).toHaveProperty('memorialDay')
        expect(holidays2026).toHaveProperty('july4th')
        expect(holidays2026).toHaveProperty('laborDay')
        expect(holidays2026).toHaveProperty('thanksgiving')
        expect(holidays2026).toHaveProperty('christmas')
      })

      it('should calculate Memorial Day correctly (last Monday of May)', () => {
        const memorialDay = holidays2026.memorialDay
        expect(memorialDay.date.getFullYear()).toBe(2026)
        expect(memorialDay.date.getMonth()).toBe(4) // May (0-indexed)
        expect(memorialDay.date.getDate()).toBe(25) // May 25, 2026
        expect(memorialDay.date.getDay()).toBe(1) // Monday
        expect(memorialDay.name).toBe('Memorial Day')
        expect(memorialDay.type).toBe('floating')
      })

      it('should calculate July 4th correctly (fixed date)', () => {
        const july4th = holidays2026.july4th
        expect(july4th.date.getFullYear()).toBe(2026)
        expect(july4th.date.getMonth()).toBe(6) // July (0-indexed)
        expect(july4th.date.getDate()).toBe(4)
        expect(july4th.name).toBe('July 4th')
        expect(july4th.type).toBe('fixed')
      })

      it('should calculate Labor Day correctly (first Monday of September)', () => {
        const laborDay = holidays2026.laborDay
        expect(laborDay.date.getFullYear()).toBe(2026)
        expect(laborDay.date.getMonth()).toBe(8) // September (0-indexed)
        expect(laborDay.date.getDate()).toBe(7) // September 7, 2026
        expect(laborDay.date.getDay()).toBe(1) // Monday
        expect(laborDay.name).toBe('Labor Day')
        expect(laborDay.type).toBe('floating')
      })

      it('should calculate Thanksgiving correctly (4th Thursday of November)', () => {
        const thanksgiving = holidays2026.thanksgiving
        expect(thanksgiving.date.getFullYear()).toBe(2026)
        expect(thanksgiving.date.getMonth()).toBe(10) // November (0-indexed)
        expect(thanksgiving.date.getDate()).toBe(26) // November 26, 2026
        expect(thanksgiving.date.getDay()).toBe(4) // Thursday
        expect(thanksgiving.name).toBe('Thanksgiving')
        expect(thanksgiving.type).toBe('floating')
      })

      it('should calculate New Year\'s Day correctly (fixed date)', () => {
        const newYears = holidays2026.newYearsDay
        expect(newYears.date.getFullYear()).toBe(2026)
        expect(newYears.date.getMonth()).toBe(0) // January
        expect(newYears.date.getDate()).toBe(1)
        expect(newYears.name).toBe("New Year's Day")
        expect(newYears.type).toBe('fixed')
      })

      it('should calculate Christmas correctly (fixed date)', () => {
        const christmas = holidays2026.christmas
        expect(christmas.date.getFullYear()).toBe(2026)
        expect(christmas.date.getMonth()).toBe(11) // December (0-indexed)
        expect(christmas.date.getDate()).toBe(25)
        expect(christmas.name).toBe('Christmas')
        expect(christmas.type).toBe('fixed')
      })
    })

    describe('2027 holidays', () => {
      const holidays2027 = getHolidaysForYear(2027)

      it('should calculate Memorial Day correctly (last Monday of May)', () => {
        const memorialDay = holidays2027.memorialDay
        expect(memorialDay.date.getFullYear()).toBe(2027)
        expect(memorialDay.date.getMonth()).toBe(4) // May
        expect(memorialDay.date.getDate()).toBe(31) // May 31, 2027
        expect(memorialDay.date.getDay()).toBe(1) // Monday
      })

      it('should calculate Labor Day correctly (first Monday of September)', () => {
        const laborDay = holidays2027.laborDay
        expect(laborDay.date.getFullYear()).toBe(2027)
        expect(laborDay.date.getMonth()).toBe(8) // September
        expect(laborDay.date.getDate()).toBe(6) // September 6, 2027
        expect(laborDay.date.getDay()).toBe(1) // Monday
      })

      it('should calculate Thanksgiving correctly (4th Thursday of November)', () => {
        const thanksgiving = holidays2027.thanksgiving
        expect(thanksgiving.date.getFullYear()).toBe(2027)
        expect(thanksgiving.date.getMonth()).toBe(10) // November
        expect(thanksgiving.date.getDate()).toBe(25) // November 25, 2027
        expect(thanksgiving.date.getDay()).toBe(4) // Thursday
      })
    })

    describe('leap year (2024)', () => {
      const holidays2024 = getHolidaysForYear(2024)

      it('should calculate Memorial Day correctly in leap year', () => {
        const memorialDay = holidays2024.memorialDay
        expect(memorialDay.date.getFullYear()).toBe(2024)
        expect(memorialDay.date.getMonth()).toBe(4) // May
        expect(memorialDay.date.getDate()).toBe(27) // May 27, 2024
        expect(memorialDay.date.getDay()).toBe(1) // Monday
      })

      it('should calculate Labor Day correctly in leap year', () => {
        const laborDay = holidays2024.laborDay
        expect(laborDay.date.getFullYear()).toBe(2024)
        expect(laborDay.date.getMonth()).toBe(8) // September
        expect(laborDay.date.getDate()).toBe(2) // September 2, 2024
        expect(laborDay.date.getDay()).toBe(1) // Monday
      })

      it('should calculate Thanksgiving correctly in leap year', () => {
        const thanksgiving = holidays2024.thanksgiving
        expect(thanksgiving.date.getFullYear()).toBe(2024)
        expect(thanksgiving.date.getMonth()).toBe(10) // November
        expect(thanksgiving.date.getDate()).toBe(28) // November 28, 2024
        expect(thanksgiving.date.getDay()).toBe(4) // Thursday
      })
    })

    describe('date object integrity', () => {
      it('should return Date objects, not strings', () => {
        const holidays = getHolidaysForYear(2026)
        expect(holidays.newYearsDay.date).toBeInstanceOf(Date)
        expect(holidays.memorialDay.date).toBeInstanceOf(Date)
        expect(holidays.july4th.date).toBeInstanceOf(Date)
        expect(holidays.laborDay.date).toBeInstanceOf(Date)
        expect(holidays.thanksgiving.date).toBeInstanceOf(Date)
        expect(holidays.christmas.date).toBeInstanceOf(Date)
      })

      it('should have midnight timestamps (no time component)', () => {
        const holidays = getHolidaysForYear(2026)
        expect(holidays.memorialDay.date.getHours()).toBe(0)
        expect(holidays.memorialDay.date.getMinutes()).toBe(0)
        expect(holidays.memorialDay.date.getSeconds()).toBe(0)
        expect(holidays.memorialDay.date.getMilliseconds()).toBe(0)
      })
    })
  })

  describe('Floating Holiday Edge Cases', () => {
    it('should handle Memorial Day when May starts on Monday', () => {
      // May 2023 starts on Monday - last Monday is May 29
      const holidays2023 = getHolidaysForYear(2023)
      expect(holidays2023.memorialDay.date.getDate()).toBe(29)
      expect(holidays2023.memorialDay.date.getMonth()).toBe(4) // May
    })

    it('should handle Labor Day when September starts on Monday', () => {
      // September 2025 starts on Monday - first Monday is Sept 1
      const holidays2025 = getHolidaysForYear(2025)
      expect(holidays2025.laborDay.date.getDate()).toBe(1)
      expect(holidays2025.laborDay.date.getMonth()).toBe(8) // September
    })

    it('should handle Thanksgiving when November starts on Thursday', () => {
      // November 2029 starts on Thursday - 4th Thursday is Nov 22
      const holidays2029 = getHolidaysForYear(2029)
      expect(holidays2029.thanksgiving.date.getDate()).toBe(22)
      expect(holidays2029.thanksgiving.date.getMonth()).toBe(10) // November
      expect(holidays2029.thanksgiving.date.getDay()).toBe(4) // Thursday
    })
  })
})

describe('Week Calculations', () => {
  describe('getWeekContainingDate', () => {
    it('should find week containing a date (Saturday start)', () => {
      // July 4, 2026 is a Saturday - should be start of its own week
      const july4 = new Date(2026, 6, 4)
      const week = getWeekContainingDate(july4, 6) // 6 = Saturday

      expect(week.start.getFullYear()).toBe(2026)
      expect(week.start.getMonth()).toBe(6) // July
      expect(week.start.getDate()).toBe(4) // Saturday, July 4
      expect(week.start.getDay()).toBe(6) // Saturday

      expect(week.end.getFullYear()).toBe(2026)
      expect(week.end.getMonth()).toBe(6) // July
      expect(week.end.getDate()).toBe(11) // Next Saturday
    })

    it('should find week containing mid-week date (Saturday start)', () => {
      // Tuesday, July 7, 2026 - should be in week starting Sat July 4
      const tuesday = new Date(2026, 6, 7)
      const week = getWeekContainingDate(tuesday, 6) // Saturday start

      expect(week.start.getDate()).toBe(4) // Previous Saturday
      expect(week.end.getDate()).toBe(11) // Next Saturday
    })

    it('should work with Sunday start weeks', () => {
      // July 4, 2026 is Saturday - in week starting Sunday June 28
      const july4 = new Date(2026, 6, 4)
      const week = getWeekContainingDate(july4, 0) // 0 = Sunday

      expect(week.start.getDay()).toBe(0) // Sunday
      expect(week.start.getMonth()).toBe(5) // June
      expect(week.start.getDate()).toBe(28) // June 28
    })

    it('should return 7-day week span', () => {
      const date = new Date(2026, 6, 15)
      const week = getWeekContainingDate(date, 6)

      const diffMs = week.end.getTime() - week.start.getTime()
      const diffDays = diffMs / (1000 * 60 * 60 * 24)
      expect(diffDays).toBe(7)
    })

    it('should have midnight timestamps for week boundaries', () => {
      const date = new Date(2026, 6, 15)
      const week = getWeekContainingDate(date, 6)

      expect(week.start.getHours()).toBe(0)
      expect(week.start.getMinutes()).toBe(0)
      expect(week.end.getHours()).toBe(0)
      expect(week.end.getMinutes()).toBe(0)
    })
  })
})

describe('Date Formatting', () => {
  describe('formatDateShort', () => {
    it('should format dates as "Mon D"', () => {
      const may25 = new Date(2026, 4, 25)
      expect(formatDateShort(may25)).toBe('May 25')

      const july4 = new Date(2026, 6, 4)
      expect(formatDateShort(july4)).toBe('Jul 4')
    })

    it('should handle single-digit days', () => {
      const jan1 = new Date(2026, 0, 1)
      expect(formatDateShort(jan1)).toBe('Jan 1')
    })

    it('should handle different months', () => {
      const dec25 = new Date(2026, 11, 25)
      expect(formatDateShort(dec25)).toBe('Dec 25')
    })
  })

  describe('formatWeekRange', () => {
    it('should format week ranges', () => {
      const start = new Date(2026, 6, 4) // July 4
      const end = new Date(2026, 6, 11) // July 11
      expect(formatWeekRange(start, end)).toBe('Jul 4 - Jul 11')
    })

    it('should handle cross-month ranges', () => {
      const start = new Date(2026, 5, 27) // June 27
      const end = new Date(2026, 6, 4) // July 4
      expect(formatWeekRange(start, end)).toBe('Jun 27 - Jul 4')
    })
  })
})

describe('Holiday Relationship', () => {
  describe('getWeekHolidayRelationship', () => {
    const holidays2026 = getHolidaysForYear(2026)

    it('should identify holiday week', () => {
      // July 4, 2026 is a Saturday - start of the July 4th week
      const july4Week = new Date(2026, 6, 4)
      const relationship = getWeekHolidayRelationship(july4Week, holidays2026, 6)

      expect(relationship.holiday.name).toBe('July 4th')
      expect(relationship.weeksAway).toBe(0)
      expect(relationship.relationship).toBe('July 4th week')
    })

    it('should identify weeks before a holiday', () => {
      // Week starting June 27 - 1 week before July 4
      const weekBefore = new Date(2026, 5, 27)
      const relationship = getWeekHolidayRelationship(weekBefore, holidays2026, 6)

      expect(relationship.holiday.name).toBe('July 4th')
      expect(relationship.weeksAway).toBe(-1)
      expect(relationship.relationship).toBe('1 week before July 4th')
    })

    it('should identify weeks after a holiday', () => {
      // Week starting July 11 - 1 week after July 4
      const weekAfter = new Date(2026, 6, 11)
      const relationship = getWeekHolidayRelationship(weekAfter, holidays2026, 6)

      expect(relationship.holiday.name).toBe('July 4th')
      expect(relationship.weeksAway).toBe(1)
      expect(relationship.relationship).toBe('1 week after July 4th')
    })

    it('should pluralize "weeks" correctly', () => {
      // 2 weeks before Memorial Day (May 25, 2026)
      const twoWeeksBefore = new Date(2026, 4, 11)
      const relationship = getWeekHolidayRelationship(twoWeeksBefore, holidays2026, 6)

      expect(relationship.weeksAway).toBe(-2)
      expect(relationship.relationship).toBe('2 weeks before Memorial Day')
    })

    it('should find nearest holiday', () => {
      // Mid-August week should be near Labor Day or July 4th
      const midAugust = new Date(2026, 7, 15)
      const relationship = getWeekHolidayRelationship(midAugust, holidays2026, 6)

      // Should find closest holiday (either July 4th or Labor Day)
      expect(relationship.holiday).toBeDefined()
      expect(relationship.weeksAway).toBeDefined()
    })
  })
})

describe('Week Key Functions', () => {
  describe('weekKey', () => {
    it('should create unique key for week start date', () => {
      const date = new Date(2026, 6, 4) // July 4, 2026
      expect(weekKey(date)).toBe('2026-07-04')
    })

    it('should pad single-digit months and days', () => {
      const date = new Date(2026, 0, 5) // January 5, 2026
      expect(weekKey(date)).toBe('2026-01-05')
    })

    it('should handle different years', () => {
      const date2027 = new Date(2027, 5, 15)
      expect(weekKey(date2027)).toBe('2027-06-15')
    })
  })

  describe('parseWeekKey', () => {
    it('should parse key back to Date object', () => {
      const key = '2026-07-04'
      const date = parseWeekKey(key)

      expect(date).toBeInstanceOf(Date)
      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth()).toBe(6) // July (0-indexed)
      expect(date.getDate()).toBe(4)
    })

    it('should handle single-digit days and months', () => {
      const key = '2026-01-05'
      const date = parseWeekKey(key)

      expect(date.getFullYear()).toBe(2026)
      expect(date.getMonth()).toBe(0) // January
      expect(date.getDate()).toBe(5)
    })

    it('should round-trip with weekKey', () => {
      const original = new Date(2026, 11, 25) // Christmas 2026
      const key = weekKey(original)
      const parsed = parseWeekKey(key)

      expect(parsed.getFullYear()).toBe(original.getFullYear())
      expect(parsed.getMonth()).toBe(original.getMonth())
      expect(parsed.getDate()).toBe(original.getDate())
    })
  })
})
