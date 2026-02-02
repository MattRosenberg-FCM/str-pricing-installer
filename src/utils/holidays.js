/**
 * STR Pricing Updater - Holiday Utilities
 * (c) 2026 by Matthew J Rosenberg
 */

// Calculate US holidays for any given year

// Get the Nth occurrence of a weekday in a month
// weekday: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
// n: 1 = first, 2 = second, etc. Use -1 for last
function getNthWeekdayOfMonth(year, month, weekday, n) {
  if (n === -1) {
    // Last occurrence - start from end of month and work backwards
    const lastDay = new Date(year, month + 1, 0) // Last day of month
    let date = lastDay.getDate()
    while (new Date(year, month, date).getDay() !== weekday) {
      date--
    }
    return new Date(year, month, date)
  }

  // Nth occurrence - start from beginning
  let count = 0
  for (let day = 1; day <= 31; day++) {
    const d = new Date(year, month, day)
    if (d.getMonth() !== month) break // Went past end of month
    if (d.getDay() === weekday) {
      count++
      if (count === n) return d
    }
  }
  return null
}

// Calculate all standard holidays for a year
export function getHolidaysForYear(year) {
  return {
    newYearsDay: {
      name: "New Year's Day",
      date: new Date(year, 0, 1), // January 1
      type: 'fixed'
    },
    memorialDay: {
      name: 'Memorial Day',
      date: getNthWeekdayOfMonth(year, 4, 1, -1), // Last Monday of May
      type: 'floating'
    },
    july4th: {
      name: 'July 4th',
      date: new Date(year, 6, 4), // July 4
      type: 'fixed'
    },
    laborDay: {
      name: 'Labor Day',
      date: getNthWeekdayOfMonth(year, 8, 1, 1), // First Monday of September
      type: 'floating'
    },
    thanksgiving: {
      name: 'Thanksgiving',
      date: getNthWeekdayOfMonth(year, 10, 4, 4), // 4th Thursday of November
      type: 'floating'
    },
    christmas: {
      name: 'Christmas',
      date: new Date(year, 11, 25), // December 25
      type: 'fixed'
    }
  }
}

// Find which rental week (Saturday-Saturday) a date falls into
// weekStartDay: 0 = Sunday, 6 = Saturday
export function getWeekContainingDate(date, weekStartDay = 6) {
  const d = new Date(date)
  const dayOfWeek = d.getDay()
  const daysToSubtract = (dayOfWeek - weekStartDay + 7) % 7

  const weekStart = new Date(d)
  weekStart.setDate(weekStart.getDate() - daysToSubtract)
  weekStart.setHours(0, 0, 0, 0)

  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)

  return {
    start: weekStart,
    end: weekEnd
  }
}

// Format date as "Mon D" (e.g., "May 26")
export function formatDateShort(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format week range as "Mon D - Mon D" (e.g., "May 24 - May 31")
export function formatWeekRange(start, end) {
  return `${formatDateShort(start)} - ${formatDateShort(end)}`
}

// Get the relationship between a week and the nearest holiday
// Returns: { holiday, relationship, weeksAway }
export function getWeekHolidayRelationship(weekStart, holidays, weekStartDay = 6) {
  let nearestHoliday = null
  let minDistance = Infinity
  let weeksAway = 0

  for (const [key, holiday] of Object.entries(holidays)) {
    const holidayWeek = getWeekContainingDate(holiday.date, weekStartDay)

    // Calculate weeks difference
    const diffMs = weekStart.getTime() - holidayWeek.start.getTime()
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24))
    const diffWeeks = Math.round(diffDays / 7)

    if (Math.abs(diffWeeks) < Math.abs(minDistance)) {
      minDistance = diffWeeks
      nearestHoliday = { key, ...holiday }
      weeksAway = diffWeeks
    }
  }

  let relationship
  if (weeksAway === 0) {
    relationship = `${nearestHoliday.name} week`
  } else if (weeksAway > 0) {
    relationship = `${weeksAway} week${weeksAway > 1 ? 's' : ''} after ${nearestHoliday.name}`
  } else {
    relationship = `${Math.abs(weeksAway)} week${Math.abs(weeksAway) > 1 ? 's' : ''} before ${nearestHoliday.name}`
  }

  return {
    holiday: nearestHoliday,
    relationship,
    weeksAway
  }
}

// Create a unique key for a week based on its start date
export function weekKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Parse a week key back to a Date
export function parseWeekKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}
