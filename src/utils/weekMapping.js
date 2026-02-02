/**
 * STR Pricing Updater - Week Mapping Utilities
 * (c) 2026 by Matthew J Rosenberg
 */

import {
  getHolidaysForYear,
  getWeekContainingDate,
  getWeekHolidayRelationship,
  weekKey,
  parseWeekKey,
  formatWeekRange,
  formatDateShort
} from './holidays.js'

// Generate all rental weeks for a year (Saturday to Saturday)
export function generateWeeksForYear(year, weekStartDay = 6) {
  const weeks = []

  // Start from first Saturday of the year (or Dec of previous year if year starts mid-week)
  let current = new Date(year, 0, 1)
  const dayOfWeek = current.getDay()
  const daysToSubtract = (dayOfWeek - weekStartDay + 7) % 7
  current.setDate(current.getDate() - daysToSubtract)

  // Generate weeks until we're past the year
  while (current.getFullYear() <= year) {
    const weekStart = new Date(current)
    const weekEnd = new Date(current)
    weekEnd.setDate(weekEnd.getDate() + 7)

    // Only include if the week starts in this year
    if (weekStart.getFullYear() === year) {
      weeks.push({
        start: weekStart,
        end: weekEnd,
        key: weekKey(weekStart)
      })
    }

    current.setDate(current.getDate() + 7)
  }

  return weeks
}

// Map weeks from source year to target year based on holiday relationships
export function mapWeeksByHolidays(sourceWeeks, sourceYear, targetYear, anchors = [], weekStartDay = 6) {
  const sourceHolidays = getHolidaysForYear(sourceYear)
  const targetHolidays = getHolidaysForYear(targetYear)

  // Add enabled anchors to holidays
  const allSourceHolidays = { ...sourceHolidays }
  const allTargetHolidays = { ...targetHolidays }

  // Filter to only enabled anchors
  const enabledAnchors = anchors.filter(a => a.enabled)

  enabledAnchors.forEach(anchor => {
    const key = anchor.id
    if (anchor.sourceDate) {
      allSourceHolidays[key] = {
        name: anchor.name,
        date: new Date(anchor.sourceDate),
        type: anchor.type
      }
    }
    if (anchor.targetDate) {
      allTargetHolidays[key] = {
        name: anchor.name,
        date: new Date(anchor.targetDate),
        type: anchor.type
      }
    }
  })

  const mappings = []

  sourceWeeks.forEach(sourceWeek => {
    const sourceStart = typeof sourceWeek.start === 'string'
      ? parseWeekKey(sourceWeek.weekKey || sourceWeek.key)
      : new Date(sourceWeek.start?.year ?? sourceWeek.startDate?.year,
                 sourceWeek.start?.month ?? sourceWeek.startDate?.month,
                 sourceWeek.start?.day ?? sourceWeek.startDate?.day)

    // Get relationship to nearest holiday
    const relationship = getWeekHolidayRelationship(sourceStart, allSourceHolidays, weekStartDay)

    // Find the corresponding week in target year
    const targetHoliday = allTargetHolidays[relationship.holiday.key]
    if (!targetHoliday) {
      // Custom anchor might not exist in target year
      mappings.push({
        source: sourceWeek,
        sourceStart,
        target: null,
        relationship: relationship.relationship,
        holidayKey: relationship.holiday.key,
        weeksAway: relationship.weeksAway,
        error: 'No matching anchor in target year'
      })
      return
    }

    const targetHolidayWeek = getWeekContainingDate(targetHoliday.date, weekStartDay)
    const targetWeekStart = new Date(targetHolidayWeek.start)
    targetWeekStart.setDate(targetWeekStart.getDate() + (relationship.weeksAway * 7))

    const targetWeekEnd = new Date(targetWeekStart)
    targetWeekEnd.setDate(targetWeekEnd.getDate() + 7)

    mappings.push({
      source: sourceWeek,
      sourceStart,
      sourceRange: formatWeekRange(sourceStart, new Date(sourceStart.getTime() + 7 * 24 * 60 * 60 * 1000)),
      target: {
        start: targetWeekStart,
        end: targetWeekEnd,
        key: weekKey(targetWeekStart)
      },
      targetRange: formatWeekRange(targetWeekStart, targetWeekEnd),
      relationship: relationship.relationship,
      holidayKey: relationship.holiday.key,
      weeksAway: relationship.weeksAway,
      proposedPrice: sourceWeek.price
    })
  })

  return mappings
}

// Detect conflicts in the mapping
export function detectConflicts(mappings, targetYear, weekStartDay = 6) {
  const conflicts = []

  // Generate all possible weeks for target year to detect gaps
  const allTargetWeeks = generateWeeksForYear(targetYear, weekStartDay)
  const mappedTargetKeys = new Set()
  const targetKeyToMappings = new Map()

  // Build index of mappings by target week
  mappings.forEach(mapping => {
    if (mapping.target) {
      const key = mapping.target.key
      mappedTargetKeys.add(key)

      if (!targetKeyToMappings.has(key)) {
        targetKeyToMappings.set(key, [])
      }
      targetKeyToMappings.get(key).push(mapping)
    }
  })

  // CONFLICT TYPE 2: COLLISION - Multiple source weeks map to same target week
  targetKeyToMappings.forEach((maps, targetKey) => {
    if (maps.length > 1) {
      conflicts.push({
        type: 'collision',
        targetWeek: targetKey,
        targetRange: maps[0].targetRange,
        mappings: maps.map(m => ({
          sourceRange: m.sourceRange,
          price: m.source.price,
          relationship: m.relationship
        })),
        description: `Both ${maps.map(m => m.sourceRange).join(' and ')} would map to ${maps[0].targetRange}. Which price should apply?`,
        options: [
          ...maps.map((m, i) => ({
            label: `Use ${m.sourceRange} price (${m.source.price})`,
            value: m.source.price,
            sourceIndex: i
          })),
          { label: 'Enter custom price', value: 'custom', sourceIndex: -1 }
        ],
        resolved: false,
        resolution: null
      })
    }
  })

  // CONFLICT TYPE 3: GAP - Target weeks with no source mapping
  const targetHolidays = getHolidaysForYear(targetYear)

  allTargetWeeks.forEach(targetWeek => {
    // Only check weeks in the rental season (roughly April-October for Cape Cod)
    const month = targetWeek.start.getMonth()
    if (month < 3 || month > 10) return // Skip off-season for gap detection

    if (!mappedTargetKeys.has(targetWeek.key)) {
      const relationship = getWeekHolidayRelationship(targetWeek.start, targetHolidays, weekStartDay)

      // Find nearest mapped weeks
      const targetTime = targetWeek.start.getTime()
      let nearestBefore = null
      let nearestAfter = null

      mappings.forEach(m => {
        if (!m.target) return
        const mTime = m.target.start.getTime()
        if (mTime < targetTime && (!nearestBefore || mTime > nearestBefore.target.start.getTime())) {
          nearestBefore = m
        }
        if (mTime > targetTime && (!nearestAfter || mTime < nearestAfter.target.start.getTime())) {
          nearestAfter = m
        }
      })

      conflicts.push({
        type: 'gap',
        targetWeek: targetWeek.key,
        targetRange: formatWeekRange(targetWeek.start, targetWeek.end),
        relationship: relationship.relationship,
        nearestBefore: nearestBefore ? {
          range: nearestBefore.targetRange,
          price: nearestBefore.proposedPrice
        } : null,
        nearestAfter: nearestAfter ? {
          range: nearestAfter.targetRange,
          price: nearestAfter.proposedPrice
        } : null,
        description: `No source week maps to ${formatWeekRange(targetWeek.start, targetWeek.end)} (${relationship.relationship}). How should we price it?`,
        options: [
          nearestBefore && { label: `Use previous week's price (${nearestBefore.proposedPrice})`, value: nearestBefore.proposedPrice },
          nearestAfter && { label: `Use next week's price (${nearestAfter.proposedPrice})`, value: nearestAfter.proposedPrice },
          nearestBefore && nearestAfter && {
            label: 'Interpolate between neighbors',
            value: 'interpolate',
            interpolatedPrice: interpolatePrice(nearestBefore.proposedPrice, nearestAfter.proposedPrice)
          },
          { label: 'Enter custom price', value: 'custom' }
        ].filter(Boolean),
        resolved: false,
        resolution: null
      })
    }
  })

  // CONFLICT TYPE 4: STRATEGY REVERSAL - Check if relative position changes
  mappings.forEach((mapping, idx) => {
    if (!mapping.target || !mapping.proposedPrice) return

    const currentPrice = parsePrice(mapping.proposedPrice)
    if (isNaN(currentPrice)) return

    // Find neighbors in source year
    const sourcePrev = mappings[idx - 1]
    const sourceNext = mappings[idx + 1]

    if (!sourcePrev || !sourceNext) return

    const sourcePrevPrice = parsePrice(sourcePrev.source?.price || sourcePrev.proposedPrice)
    const sourceNextPrice = parsePrice(sourceNext.source?.price || sourceNext.proposedPrice)

    if (isNaN(sourcePrevPrice) || isNaN(sourceNextPrice)) return

    // Determine if this was a peak (higher than neighbors) or valley (lower)
    const sourceAvgNeighbor = (sourcePrevPrice + sourceNextPrice) / 2
    const sourceRelative = currentPrice - sourceAvgNeighbor
    const wasAbove = sourceRelative > 100 // More than $100 above average
    const wasBelow = sourceRelative < -100 // More than $100 below average

    if (!wasAbove && !wasBelow) return // Not significantly different from neighbors

    // Find neighbors in target mapping
    const targetKey = mapping.target.key
    const sortedMappings = [...mappings]
      .filter(m => m.target)
      .sort((a, b) => a.target.start.getTime() - b.target.start.getTime())

    const targetIdx = sortedMappings.findIndex(m => m.target.key === targetKey)
    if (targetIdx <= 0 || targetIdx >= sortedMappings.length - 1) return

    const targetPrev = sortedMappings[targetIdx - 1]
    const targetNext = sortedMappings[targetIdx + 1]

    const targetPrevPrice = parsePrice(targetPrev.proposedPrice)
    const targetNextPrice = parsePrice(targetNext.proposedPrice)

    if (isNaN(targetPrevPrice) || isNaN(targetNextPrice)) return

    const targetAvgNeighbor = (targetPrevPrice + targetNextPrice) / 2
    const targetRelative = currentPrice - targetAvgNeighbor
    const isAbove = targetRelative > 100
    const isBelow = targetRelative < -100

    // Check for reversal
    if ((wasAbove && isBelow) || (wasBelow && isAbove)) {
      const sourcePattern = wasAbove ? 'higher' : 'lower'
      const targetPattern = isAbove ? 'higher' : 'lower'

      conflicts.push({
        type: 'strategy_reversal',
        sourceRange: mapping.sourceRange,
        targetRange: mapping.targetRange,
        price: mapping.proposedPrice,
        sourcePattern,
        targetPattern,
        description: `${mapping.sourceRange} was priced ${mapping.proposedPrice}, which was ${sourcePattern} than its neighbors. The proposed ${mapping.targetRange} at ${mapping.proposedPrice} would be ${targetPattern} than ITS neighbors - the opposite pattern. Is this intentional?`,
        options: [
          { label: 'Keep as mapped (intentional change)', value: 'keep' },
          { label: 'Adjust to maintain relative position', value: 'adjust' }
        ],
        resolved: false,
        resolution: null
      })
    }
  })

  return conflicts
}

// Helper to parse price string to number
function parsePrice(priceStr) {
  if (!priceStr) return NaN
  return parseInt(String(priceStr).replace(/[$,]/g, '')) || NaN
}

// Helper to interpolate between two prices
function interpolatePrice(price1, price2) {
  const p1 = parsePrice(price1)
  const p2 = parsePrice(price2)
  if (isNaN(p1) || isNaN(p2)) return price1
  const avg = Math.round((p1 + p2) / 2)
  return `$${avg.toLocaleString()}`
}

// Apply conflict resolutions to mappings
export function applyResolutions(mappings, conflicts) {
  const resolvedMappings = [...mappings]
  const additionalWeeks = []

  conflicts.forEach(conflict => {
    if (!conflict.resolved || !conflict.resolution) return

    if (conflict.type === 'collision') {
      // Remove all but the chosen mapping
      const targetKey = conflict.targetWeek
      let kept = false
      for (let i = resolvedMappings.length - 1; i >= 0; i--) {
        if (resolvedMappings[i].target?.key === targetKey) {
          if (!kept && conflict.resolution.sourceIndex !== undefined) {
            if (conflict.resolution.sourceIndex === conflict.mappings.findIndex(
              m => m.sourceRange === resolvedMappings[i].sourceRange
            )) {
              resolvedMappings[i].proposedPrice = conflict.resolution.value
              kept = true
            } else {
              resolvedMappings.splice(i, 1)
            }
          } else if (conflict.resolution.value === 'custom') {
            resolvedMappings[i].proposedPrice = conflict.resolution.customPrice
            kept = true
          }
        }
      }
    } else if (conflict.type === 'gap') {
      // Add a new week with the resolved price
      const targetStart = parseWeekKey(conflict.targetWeek)
      const targetEnd = new Date(targetStart)
      targetEnd.setDate(targetEnd.getDate() + 7)

      let price = conflict.resolution.value
      if (price === 'interpolate') {
        price = conflict.resolution.interpolatedPrice
      } else if (price === 'custom') {
        price = conflict.resolution.customPrice
      }

      additionalWeeks.push({
        source: null,
        sourceStart: null,
        sourceRange: 'N/A (gap fill)',
        target: {
          start: targetStart,
          end: targetEnd,
          key: conflict.targetWeek
        },
        targetRange: conflict.targetRange,
        relationship: conflict.relationship,
        proposedPrice: price,
        isGapFill: true
      })
    }
  })

  return [...resolvedMappings, ...additionalWeeks]
    .filter(m => m.target)
    .sort((a, b) => a.target.start.getTime() - b.target.start.getTime())
}

// Build the holiday anchor comparison table
export function buildHolidayAnchorTable(sourceYear, targetYear, anchors = [], weekStartDay = 6) {
  const displayAnchors = []

  // Filter to only enabled anchors
  const enabledAnchors = anchors.filter(a => a.enabled)

  enabledAnchors.forEach(anchor => {
    if (anchor.sourceDate && anchor.targetDate) {
      const sourceDate = new Date(anchor.sourceDate)
      const targetDate = new Date(anchor.targetDate)
      const sourceWeek = getWeekContainingDate(sourceDate, weekStartDay)
      const targetWeek = getWeekContainingDate(targetDate, weekStartDay)

      displayAnchors.push({
        name: anchor.name,
        type: anchor.type,
        sourceDate: formatDateShort(sourceDate),
        sourceWeek: formatWeekRange(sourceWeek.start, sourceWeek.end),
        targetDate: formatDateShort(targetDate),
        targetWeek: formatWeekRange(targetWeek.start, targetWeek.end),
        deletable: anchor.type === 'custom',
        anchorId: anchor.id
      })
    }
  })

  return displayAnchors
}
