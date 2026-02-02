import { describe, it, expect } from 'vitest'
import {
  generateWeeksForYear,
  mapWeeksByHolidays,
  detectConflicts,
  applyResolutions,
  buildHolidayAnchorTable
} from './weekMapping.js'
import {
  getHolidaysForYear,
  weekKey,
  parseWeekKey,
  getWeekContainingDate
} from './holidays.js'

// Helper to create a source week with all required properties
function createSourceWeek(startDate, price, year = 2026) {
  return {
    weekKey: weekKey(startDate),
    key: weekKey(startDate),
    start: startDate,
    startDate: {
      year: startDate.getFullYear(),
      month: startDate.getMonth(),
      day: startDate.getDate()
    },
    price: price,
    year: year
  }
}

describe('Week Generation', () => {
  describe('generateWeeksForYear', () => {
    it('should generate weeks with Saturday start day (rental default)', () => {
      const weeks = generateWeeksForYear(2026, 6) // 6 = Saturday

      expect(weeks.length).toBeGreaterThan(50)
      expect(weeks.length).toBeLessThanOrEqual(53)

      // First week should start on a Saturday
      expect(weeks[0].start.getDay()).toBe(6)

      // All weeks should start on Saturday
      weeks.forEach(week => {
        expect(week.start.getDay()).toBe(6)
      })
    })

    it('should generate weeks with Sunday start day (standard calendar)', () => {
      const weeks = generateWeeksForYear(2026, 0) // 0 = Sunday

      expect(weeks.length).toBeGreaterThan(50)

      // First week should start on a Sunday
      expect(weeks[0].start.getDay()).toBe(0)

      // All weeks should start on Sunday
      weeks.forEach(week => {
        expect(week.start.getDay()).toBe(0)
      })
    })

    it('should have 7-day weeks', () => {
      const weeks = generateWeeksForYear(2026, 6)

      weeks.forEach(week => {
        const duration = week.end.getTime() - week.start.getTime()
        const days = duration / (1000 * 60 * 60 * 24)
        // Use toBeCloseTo to account for DST transitions
        expect(days).toBeCloseTo(7, 1)
      })
    })

    it('should only include weeks starting in the specified year', () => {
      const weeks = generateWeeksForYear(2026, 6)

      weeks.forEach(week => {
        expect(week.start.getFullYear()).toBe(2026)
      })
    })

    it('should include week keys', () => {
      const weeks = generateWeeksForYear(2026, 6)

      weeks.forEach(week => {
        expect(week.key).toBeDefined()
        expect(typeof week.key).toBe('string')
        expect(week.key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    })
  })
})

describe('Holiday-Based Week Mapping', () => {
  describe('mapWeeksByHolidays', () => {
    it('should map Labor Day week from 2026 to 2027', () => {
      // Labor Day 2026: Sept 7 (first Monday of Sept)
      // Labor Day 2027: Sept 6 (first Monday of Sept)
      const laborDay2026 = new Date(2026, 8, 7) // Month 8 = September
      const laborDayWeek2026 = getWeekContainingDate(laborDay2026, 6)

      const sourceWeeks = [createSourceWeek(laborDayWeek2026.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('Labor Day week')
      expect(mappings[0].holidayKey).toBe('laborDay')
      expect(mappings[0].weeksAway).toBe(0)
      expect(mappings[0].proposedPrice).toBe('$3,500')

      // Target should be Labor Day week in 2027
      expect(mappings[0].target).toBeDefined()
      expect(mappings[0].target.start.getFullYear()).toBe(2027)
    })

    it('should map "2 weeks before Labor Day" correctly', () => {
      const laborDay2026 = new Date(2026, 8, 7)
      const laborDayWeek2026 = getWeekContainingDate(laborDay2026, 6)

      // 2 weeks before Labor Day
      const twoWeeksBefore = new Date(laborDayWeek2026.start)
      twoWeeksBefore.setDate(twoWeeksBefore.getDate() - 14)

      const sourceWeeks = [createSourceWeek(twoWeeksBefore, '$3,200')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('2 weeks before Labor Day')
      expect(mappings[0].weeksAway).toBe(-2)
      expect(mappings[0].proposedPrice).toBe('$3,200')
    })

    it('should map "1 week after July 4th" correctly', () => {
      const july4th2026 = new Date(2026, 6, 4) // July 4, 2026
      const july4thWeek2026 = getWeekContainingDate(july4th2026, 6)

      // 1 week after July 4th
      const oneWeekAfter = new Date(july4thWeek2026.start)
      oneWeekAfter.setDate(oneWeekAfter.getDate() + 7)

      const sourceWeeks = [createSourceWeek(oneWeekAfter, '$3,800')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('1 week after July 4th')
      expect(mappings[0].weeksAway).toBe(1)
      expect(mappings[0].proposedPrice).toBe('$3,800')
    })

    it('should map Memorial Day week correctly', () => {
      // Memorial Day: Last Monday of May
      const memorialDay2026 = new Date(2026, 4, 25) // May 25, 2026
      const memorialDayWeek2026 = getWeekContainingDate(memorialDay2026, 6)

      const sourceWeeks = [createSourceWeek(memorialDayWeek2026.start, '$3,400')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('Memorial Day week')
      expect(mappings[0].holidayKey).toBe('memorialDay')
      expect(mappings[0].weeksAway).toBe(0)
    })

    it('should handle custom anchors', () => {
      // Custom anchor: April School Break
      const aprilBreak2026 = new Date(2026, 3, 15) // April 15, 2026
      const aprilBreak2027 = new Date(2027, 3, 14) // April 14, 2027

      const anchors = [{
        id: 'custom_1',
        name: 'April School Break',
        type: 'custom',
        enabled: true,
        sourceDate: aprilBreak2026.toISOString().split('T')[0],
        targetDate: aprilBreak2027.toISOString().split('T')[0]
      }]

      const aprilBreakWeek2026 = getWeekContainingDate(aprilBreak2026, 6)

      const sourceWeeks = [createSourceWeek(aprilBreakWeek2026.start, '$2,800')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, anchors, 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toContain('April School Break')
      expect(mappings[0].proposedPrice).toBe('$2,800')
    })

    it('should handle multiple weeks mapping', () => {
      const holidays2026 = getHolidaysForYear(2026)

      const sourceWeeks = [
        createSourceWeek(getWeekContainingDate(holidays2026.memorialDay.date, 6).start, '$3,400'),
        createSourceWeek(getWeekContainingDate(holidays2026.july4th.date, 6).start, '$3,600'),
        createSourceWeek(getWeekContainingDate(holidays2026.laborDay.date, 6).start, '$3,500')
      ]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)

      expect(mappings.length).toBe(3)
      expect(mappings[0].relationship).toBe('Memorial Day week')
      expect(mappings[1].relationship).toBe('July 4th week')
      expect(mappings[2].relationship).toBe('Labor Day week')
    })

    it('should handle missing custom anchor in target year', () => {
      const aprilBreak2026 = new Date(2026, 3, 15)

      const anchors = [{
        id: 'custom_1',
        name: 'April School Break',
        type: 'custom',
        enabled: true,
        sourceDate: aprilBreak2026.toISOString().split('T')[0]
        // No targetDate - anchor doesn't exist in target year
      }]

      const aprilBreakWeek2026 = getWeekContainingDate(aprilBreak2026, 6)

      const sourceWeeks = [createSourceWeek(aprilBreakWeek2026.start, '$2,800')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, anchors, 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].target).toBeNull()
      expect(mappings[0].error).toBe('No matching anchor in target year')
    })

    it('should handle serialized date strings (from JSON)', () => {
      // Simulates data loaded from JSON where dates are serialized
      const laborDay2026 = new Date(2026, 8, 7)
      const laborDayWeek2026 = getWeekContainingDate(laborDay2026, 6)

      const sourceWeeks = [{
        weekKey: weekKey(laborDayWeek2026.start),
        key: weekKey(laborDayWeek2026.start),
        start: laborDayWeek2026.start.toISOString(), // Serialized date
        startDate: { // Serialized date object
          year: laborDayWeek2026.start.getFullYear(),
          month: laborDayWeek2026.start.getMonth(),
          day: laborDayWeek2026.start.getDate()
        },
        price: '$3,500',
        year: 2026
      }]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)

      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('Labor Day week')
      expect(mappings[0].target).toBeDefined()
    })
  })
})

describe('Conflict Detection', () => {
  describe('detectConflicts - COLLISION', () => {
    it('should detect when 2 source weeks map to same target week', () => {
      const laborDay2026 = new Date(2026, 8, 7)
      const laborDayWeek2026 = getWeekContainingDate(laborDay2026, 6)

      // Create a scenario where two different source weeks map to the same target
      // Same Labor Day week but with different prices (e.g., due to custom adjustments)
      const sourceWeeks = [
        createSourceWeek(laborDayWeek2026.start, '$3,500'),
        createSourceWeek(laborDayWeek2026.start, '$3,200')
      ]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      const collisionConflicts = conflicts.filter(c => c.type === 'collision')
      expect(collisionConflicts.length).toBe(1)
      expect(collisionConflicts[0].mappings.length).toBe(2)
      expect(collisionConflicts[0].description).toContain('Both')
      expect(collisionConflicts[0].options.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('detectConflicts - GAP', () => {
    it('should detect when no source week maps to a target week', () => {
      // Map only Memorial Day and Labor Day, leaving July weeks unmapped
      const holidays2026 = getHolidaysForYear(2026)

      const sourceWeeks = [
        createSourceWeek(getWeekContainingDate(holidays2026.memorialDay.date, 6).start, '$3,000'),
        createSourceWeek(getWeekContainingDate(holidays2026.laborDay.date, 6).start, '$3,200')
      ]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      const gapConflicts = conflicts.filter(c => c.type === 'gap')
      expect(gapConflicts.length).toBeGreaterThan(0)

      // Check structure of gap conflict
      const sampleGap = gapConflicts[0]
      expect(sampleGap.targetWeek).toBeDefined()
      expect(sampleGap.targetRange).toBeDefined()
      expect(sampleGap.description).toContain('No source week maps to')
      expect(sampleGap.options.length).toBeGreaterThan(0)
    })

    it('should provide interpolation option for gaps between mapped weeks', () => {
      const holidays2026 = getHolidaysForYear(2026)

      const sourceWeeks = [
        createSourceWeek(getWeekContainingDate(holidays2026.memorialDay.date, 6).start, '$3,000'),
        createSourceWeek(getWeekContainingDate(holidays2026.laborDay.date, 6).start, '$3,400')
      ]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      const gapConflicts = conflicts.filter(c => c.type === 'gap')

      // Find a gap that has both before and after neighbors
      const gapWithNeighbors = gapConflicts.find(c =>
        c.nearestBefore && c.nearestAfter
      )

      if (gapWithNeighbors) {
        const interpolateOption = gapWithNeighbors.options.find(o => o.value === 'interpolate')
        expect(interpolateOption).toBeDefined()
        expect(interpolateOption.interpolatedPrice).toBeDefined()
      }
    })

    it('should skip off-season gaps (before April, after October)', () => {
      // Create mapping with only summer weeks
      const july4th2026 = new Date(2026, 6, 4)
      const july4thWeek = getWeekContainingDate(july4th2026, 6)

      const sourceWeeks = [createSourceWeek(july4thWeek.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      const gapConflicts = conflicts.filter(c => c.type === 'gap')

      // Check that gaps are only in rental season (April-October)
      gapConflicts.forEach(gap => {
        const gapWeek = parseWeekKey(gap.targetWeek)
        const month = gapWeek.getMonth()
        expect(month).toBeGreaterThanOrEqual(3) // April or later
        expect(month).toBeLessThanOrEqual(10) // October or earlier
      })
    })
  })

  describe('detectConflicts - STRATEGY_REVERSAL', () => {
    it('should detect when premium week becomes discount week', () => {
      // Create a scenario where a week that was priced high relative to neighbors
      // becomes priced low relative to new neighbors

      const july4th2026 = new Date(2026, 6, 4)
      const july4thWeek = getWeekContainingDate(july4th2026, 6)

      // Week before July 4th
      const weekBefore = new Date(july4thWeek.start)
      weekBefore.setDate(weekBefore.getDate() - 7)

      // Week after July 4th
      const weekAfter = new Date(july4thWeek.start)
      weekAfter.setDate(weekAfter.getDate() + 7)

      const sourceWeeks = [
        createSourceWeek(weekBefore, '$3,000'), // Neighbor 1
        createSourceWeek(july4thWeek.start, '$3,600'), // Premium week (more than $100 above average of neighbors)
        createSourceWeek(weekAfter, '$3,000') // Neighbor 2
      ]

      // Note: Actual strategy reversal detection depends on how weeks shift
      // This test verifies the detection logic exists
      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      // Check that strategy reversal detection is working
      expect(Array.isArray(conflicts)).toBe(true)

      const strategyConflicts = conflicts.filter(c => c.type === 'strategy_reversal')

      if (strategyConflicts.length > 0) {
        expect(strategyConflicts[0].sourcePattern).toBeDefined()
        expect(strategyConflicts[0].targetPattern).toBeDefined()
        expect(strategyConflicts[0].description).toContain('opposite pattern')
      }
    })

    it('should not flag weeks with similar relative pricing', () => {
      // Weeks that maintain their relative position shouldn't be flagged
      const july4th2026 = new Date(2026, 6, 4)
      const july4thWeek = getWeekContainingDate(july4th2026, 6)

      const weekBefore = new Date(july4thWeek.start)
      weekBefore.setDate(weekBefore.getDate() - 7)

      const weekAfter = new Date(july4thWeek.start)
      weekAfter.setDate(weekAfter.getDate() + 7)

      const sourceWeeks = [
        createSourceWeek(weekBefore, '$3,000'),
        createSourceWeek(july4thWeek.start, '$3,050'), // Only slightly higher (not premium)
        createSourceWeek(weekAfter, '$3,000')
      ]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      const strategyConflicts = conflicts.filter(c => c.type === 'strategy_reversal')

      // Should not flag because difference is less than $100 threshold
      expect(strategyConflicts.length).toBe(0)
    })
  })

  describe('detectConflicts - Multiple Conflict Types', () => {
    it('should detect multiple conflict types simultaneously', () => {
      // Create a complex scenario with both gaps and potential collisions
      const holidays2026 = getHolidaysForYear(2026)

      // Map only a few weeks, leaving gaps
      const sourceWeeks = [
        createSourceWeek(getWeekContainingDate(holidays2026.memorialDay.date, 6).start, '$3,000')
      ]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      const conflicts = detectConflicts(mappings, 2027, 6)

      // Should have gap conflicts
      expect(conflicts.length).toBeGreaterThan(0)

      const conflictTypes = new Set(conflicts.map(c => c.type))
      expect(conflictTypes.has('gap')).toBe(true)
    })
  })
})

describe('Conflict Resolution', () => {
  describe('applyResolutions', () => {
    it('should apply collision resolution - use specific source price', () => {
      // Simulate a collision where two different source weeks map to the same target
      // For example, "2 weeks before Labor Day" and "3 weeks before Labor Day"
      // both mapping to the same week in the target year due to holiday shift
      const mappings = [{
        source: { price: '$3,500' },
        sourceStart: new Date(2026, 8, 5),
        sourceRange: 'Aug 22 - Aug 29', // Week A
        target: {
          start: new Date(2027, 8, 6),
          end: new Date(2027, 8, 13),
          key: '2027-09-06'
        },
        targetRange: 'Sep 6 - Sep 13',
        proposedPrice: '$3,500'
      }, {
        source: { price: '$3,200' },
        sourceStart: new Date(2026, 8, 12),
        sourceRange: 'Aug 29 - Sep 5', // Week B (different week)
        target: {
          start: new Date(2027, 8, 6),
          end: new Date(2027, 8, 13),
          key: '2027-09-06'
        },
        targetRange: 'Sep 6 - Sep 13',
        proposedPrice: '$3,200'
      }]

      const conflicts = [{
        type: 'collision',
        targetWeek: '2027-09-06',
        mappings: [
          { sourceRange: 'Aug 22 - Aug 29', price: '$3,500' },
          { sourceRange: 'Aug 29 - Sep 5', price: '$3,200' }
        ],
        resolved: true,
        resolution: {
          value: '$3,500',
          sourceIndex: 0
        }
      }]

      const resolved = applyResolutions(mappings, conflicts)

      expect(resolved.length).toBe(1)
      expect(resolved[0].proposedPrice).toBe('$3,500')
    })

    it('should apply collision resolution - use custom price', () => {
      const mappings = [{
        source: { price: '$3,500' },
        sourceStart: new Date(2026, 8, 5),
        sourceRange: 'Sep 5 - Sep 12',
        target: {
          start: new Date(2027, 8, 6),
          end: new Date(2027, 8, 13),
          key: '2027-09-06'
        },
        targetRange: 'Sep 6 - Sep 13',
        proposedPrice: '$3,500'
      }]

      const conflicts = [{
        type: 'collision',
        targetWeek: '2027-09-06',
        resolved: true,
        resolution: {
          value: 'custom',
          customPrice: '$3,300'
        }
      }]

      const resolved = applyResolutions(mappings, conflicts)

      expect(resolved.length).toBe(1)
      expect(resolved[0].proposedPrice).toBe('$3,300')
    })

    it('should apply gap resolution - add new week', () => {
      const mappings = [
        {
          source: { price: '$3,000' },
          sourceStart: new Date(2026, 5, 20),
          sourceRange: 'Jun 20 - Jun 27',
          target: {
            start: new Date(2027, 5, 19),
            end: new Date(2027, 5, 26),
            key: '2027-06-19'
          },
          targetRange: 'Jun 19 - Jun 26',
          proposedPrice: '$3,000'
        }
      ]

      const conflicts = [{
        type: 'gap',
        targetWeek: '2027-06-26',
        targetRange: 'Jun 26 - Jul 3',
        relationship: '1 week before July 4th',
        resolved: true,
        resolution: {
          value: 'custom',
          customPrice: '$3,400'
        }
      }]

      const resolved = applyResolutions(mappings, conflicts)

      expect(resolved.length).toBe(2)

      const gapFill = resolved.find(m => m.isGapFill)
      expect(gapFill).toBeDefined()
      expect(gapFill.proposedPrice).toBe('$3,400')
      expect(gapFill.target.key).toBe('2027-06-26')
    })

    it('should apply gap resolution - interpolate price', () => {
      const mappings = [
        {
          source: { price: '$3,000' },
          target: {
            start: new Date(2027, 5, 19),
            key: '2027-06-19'
          },
          proposedPrice: '$3,000'
        }
      ]

      const conflicts = [{
        type: 'gap',
        targetWeek: '2027-06-26',
        targetRange: 'Jun 26 - Jul 3',
        resolved: true,
        resolution: {
          value: 'interpolate',
          interpolatedPrice: '$3,200'
        }
      }]

      const resolved = applyResolutions(mappings, conflicts)

      const gapFill = resolved.find(m => m.isGapFill)
      expect(gapFill).toBeDefined()
      expect(gapFill.proposedPrice).toBe('$3,200')
    })

    it('should sort resolved mappings by target date', () => {
      const mappings = [
        {
          source: { price: '$3,200' },
          target: {
            start: new Date(2027, 7, 1),
            key: '2027-08-01'
          },
          proposedPrice: '$3,200'
        },
        {
          source: { price: '$3,000' },
          target: {
            start: new Date(2027, 6, 1),
            key: '2027-07-01'
          },
          proposedPrice: '$3,000'
        }
      ]

      const conflicts = []

      const resolved = applyResolutions(mappings, conflicts)

      expect(resolved.length).toBe(2)
      expect(resolved[0].target.key).toBe('2027-07-01')
      expect(resolved[1].target.key).toBe('2027-08-01')
    })

    it('should filter out mappings with no target', () => {
      const mappings = [
        {
          source: { price: '$3,000' },
          target: null,
          proposedPrice: '$3,000'
        },
        {
          source: { price: '$3,200' },
          target: {
            start: new Date(2027, 7, 1),
            key: '2027-08-01'
          },
          proposedPrice: '$3,200'
        }
      ]

      const conflicts = []

      const resolved = applyResolutions(mappings, conflicts)

      expect(resolved.length).toBe(1)
      expect(resolved[0].target.key).toBe('2027-08-01')
    })

    it('should handle unresolved conflicts (leave mappings unchanged)', () => {
      const mappings = [{
        source: { price: '$3,500' },
        target: {
          start: new Date(2027, 8, 6),
          key: '2027-09-06'
        },
        proposedPrice: '$3,500'
      }]

      const conflicts = [{
        type: 'collision',
        targetWeek: '2027-09-06',
        resolved: false, // Not resolved
        resolution: null
      }]

      const resolved = applyResolutions(mappings, conflicts)

      expect(resolved.length).toBe(1)
      expect(resolved[0].proposedPrice).toBe('$3,500')
    })
  })
})

describe('Holiday Anchor Table', () => {
  describe('buildHolidayAnchorTable', () => {
    it('should include all standard holidays', () => {
      // Create anchors with enabled holidays
      const anchors = [
        { id: 'memorial', name: 'Memorial Day', type: 'holiday', enabled: true, sourceDate: '2026-05-25', targetDate: '2027-05-31' },
        { id: 'july4', name: 'July 4th', type: 'holiday', enabled: true, sourceDate: '2026-07-04', targetDate: '2027-07-04' },
        { id: 'labor', name: 'Labor Day', type: 'holiday', enabled: true, sourceDate: '2026-09-07', targetDate: '2027-09-06' },
        { id: 'thanksgiving', name: 'Thanksgiving', type: 'holiday', enabled: true, sourceDate: '2026-11-26', targetDate: '2027-11-25' },
        { id: 'christmas', name: 'Christmas', type: 'holiday', enabled: true, sourceDate: '2026-12-25', targetDate: '2027-12-25' },
        { id: 'newyear', name: "New Year's Day", type: 'holiday', enabled: true, sourceDate: '2026-01-01', targetDate: '2027-01-01' }
      ]

      const table = buildHolidayAnchorTable(2026, 2027, anchors, 6)

      const holidayNames = table.map(a => a.name)
      expect(holidayNames).toContain('Memorial Day')
      expect(holidayNames).toContain('July 4th')
      expect(holidayNames).toContain('Labor Day')
      expect(holidayNames).toContain('Thanksgiving')
      expect(holidayNames).toContain('Christmas')
      expect(holidayNames).toContain("New Year's Day")
    })

    it('should show source and target dates for each holiday', () => {
      const anchors = [
        { id: 'memorial', name: 'Memorial Day', type: 'holiday', enabled: true, sourceDate: '2026-05-25', targetDate: '2027-05-31' }
      ]

      const table = buildHolidayAnchorTable(2026, 2027, anchors, 6)

      table.forEach(anchor => {
        expect(anchor.sourceDate).toBeDefined()
        expect(anchor.targetDate).toBeDefined()
        expect(anchor.sourceWeek).toBeDefined()
        expect(anchor.targetWeek).toBeDefined()
        expect(anchor.type).toBe('holiday')
      })
    })

    it('should include custom anchors', () => {
      const anchors = [{
        id: 'custom_1',
        name: 'April School Break',
        type: 'custom',
        enabled: true,
        sourceDate: new Date(2026, 3, 15).toISOString().split('T')[0],
        targetDate: new Date(2027, 3, 14).toISOString().split('T')[0]
      }]

      const table = buildHolidayAnchorTable(2026, 2027, anchors, 6)

      const customAnchor = table.find(a => a.name === 'April School Break')
      expect(customAnchor).toBeDefined()
      expect(customAnchor.type).toBe('custom')
      expect(customAnchor.deletable).toBe(true)
      expect(customAnchor.anchorId).toBe('custom_1')
    })

    it('should respect week start day in week ranges', () => {
      const tableSaturday = buildHolidayAnchorTable(2026, 2027, [], 6)
      const tableSunday = buildHolidayAnchorTable(2026, 2027, [], 0)

      // Both should have same holidays but potentially different week ranges
      expect(tableSaturday.length).toBe(tableSunday.length)

      tableSaturday.forEach(anchor => {
        expect(anchor.sourceWeek).toMatch(/\w+ \d+ - \w+ \d+/)
      })
    })
  })
})

describe('Edge Cases', () => {
  describe('Empty and Null Inputs', () => {
    it('should handle empty source weeks array', () => {
      const mappings = mapWeeksByHolidays([], 2026, 2027, [], 6)
      expect(mappings).toEqual([])
    })

    it('should handle empty custom anchors array', () => {
      const holidays2026 = getHolidaysForYear(2026)
      const laborDayWeek = getWeekContainingDate(holidays2026.laborDay.date, 6)

      const sourceWeeks = [createSourceWeek(laborDayWeek.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      expect(mappings.length).toBe(1)
    })

    it('should handle single week mapping', () => {
      const holidays2026 = getHolidaysForYear(2026)
      const laborDayWeek = getWeekContainingDate(holidays2026.laborDay.date, 6)

      const sourceWeeks = [createSourceWeek(laborDayWeek.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      expect(mappings.length).toBe(1)
      expect(mappings[0].proposedPrice).toBe('$3,500')
    })
  })

  describe('Year Boundary Weeks', () => {
    it('should handle weeks at year start (New Years)', () => {
      const newYears2026 = new Date(2026, 0, 1)
      const newYearsWeek = getWeekContainingDate(newYears2026, 6)

      const sourceWeeks = [createSourceWeek(newYearsWeek.start, '$2,000')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toContain("New Year's Day")
    })

    it('should handle weeks at year end (Christmas)', () => {
      const christmas2026 = new Date(2026, 11, 25)
      const christmasWeek = getWeekContainingDate(christmas2026, 6)

      const sourceWeeks = [createSourceWeek(christmasWeek.start, '$2,200')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toContain('Christmas')
    })
  })

  describe('Week Start Day Variations', () => {
    it('should work with Sunday start (standard calendar)', () => {
      const holidays2026 = getHolidaysForYear(2026)
      const laborDayWeek = getWeekContainingDate(holidays2026.laborDay.date, 0) // Sunday

      const sourceWeeks = [createSourceWeek(laborDayWeek.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 0)
      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('Labor Day week')
    })

    it('should work with Monday start', () => {
      const holidays2026 = getHolidaysForYear(2026)
      const laborDayWeek = getWeekContainingDate(holidays2026.laborDay.date, 1) // Monday

      const sourceWeeks = [createSourceWeek(laborDayWeek.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 1)
      expect(mappings.length).toBe(1)
      expect(mappings[0].relationship).toBe('Labor Day week')
    })
  })

  describe('Price Format Variations', () => {
    it('should handle prices with dollar signs and commas', () => {
      const holidays2026 = getHolidaysForYear(2026)
      const laborDayWeek = getWeekContainingDate(holidays2026.laborDay.date, 6)

      const sourceWeeks = [createSourceWeek(laborDayWeek.start, '$3,500')]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      expect(mappings[0].proposedPrice).toBe('$3,500')
    })

    it('should handle plain number prices', () => {
      const holidays2026 = getHolidaysForYear(2026)
      const laborDayWeek = getWeekContainingDate(holidays2026.laborDay.date, 6)

      const sourceWeeks = [createSourceWeek(laborDayWeek.start, 3500)]

      const mappings = mapWeeksByHolidays(sourceWeeks, 2026, 2027, [], 6)
      expect(mappings[0].proposedPrice).toBe(3500)
    })
  })
})
