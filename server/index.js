/**
 * STR Pricing Updater - Server
 * (c) 2026 by Matthew J Rosenberg
 */

import express from 'express'
import cors from 'cors'
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const app = express()
const PORT = 3001

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Use DATA_DIR environment variable if provided (Electron sets this)
// Otherwise use default ./data directory (for development)
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data')

app.use(cors())
app.use(express.json())

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.post('/api/auth/capture', async (req, res) => {
  let browser = null

  try {
    console.log('Opening browser for login...')

    browser = await chromium.launch({
      headless: false,
      slowMo: 100
    })

    const context = await browser.newContext()
    const page = await context.newPage()

    console.log('Navigating to login page...')
    await page.goto('https://www.weneedavacation.com/HC/Login.aspx')

    // Focus the username field so user can start typing immediately
    try {
      await page.waitForSelector('input[type="text"], input[name*="user"], input[id*="user"], #txtEmail', { timeout: 5000 })
      const usernameField = await page.$('input[type="text"], input[name*="user"], input[id*="user"], #txtEmail')
      if (usernameField) {
        await usernameField.focus()
        console.log('Focused username field')
      }
    } catch (e) {
      console.log('Could not focus username field automatically')
    }

    console.log('Waiting for you to log in...')
    console.log('(The browser will close automatically once you reach your account page)')

    await page.waitForURL('**/HC/HCWelcome.aspx**', { timeout: 300000 })

    console.log('Login detected! Saving session...')

    const cookies = await context.cookies()

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    const sessionPath = path.join(dataDir, 'session.json')
    fs.writeFileSync(sessionPath, JSON.stringify(cookies, null, 2))

    console.log('Session saved to data/session.json')

    // Auto-detect the property after login
    console.log('Detecting your property...')

    let listingUrl = null
    let listingId = null
    let propertyName = null

    try {
      // Wait for page to fully load
      await page.waitForLoadState('networkidle')

      // Save dashboard HTML for debugging
      const dashboardHtml = await page.content()
      fs.writeFileSync(path.join(dataDir, 'dashboard.html'), dashboardHtml)

      // Method 1: Look for property link in the dashboard (usually upper right)
      // WNAV typically has a link to the property listing somewhere on the dashboard
      const propertyLink = await page.$('a[href*="Vacation-Rental"]')
      if (propertyLink) {
        listingUrl = await propertyLink.getAttribute('href')
        console.log(`Found property link: ${listingUrl}`)
      }

      // Method 2: Navigate to Calendar and Pricing to get property ID from URL
      if (!listingUrl) {
        console.log('Looking for Calendar and Pricing link...')
        const calendarLink = await page.$('a:has-text("Calendar and Pricing")') ||
                            await page.$('a:has-text("Calendar & Pricing")') ||
                            await page.$('a:has-text("Calendar")')

        if (calendarLink) {
          await calendarLink.click()
          await page.waitForLoadState('networkidle')

          const calendarUrl = page.url()
          console.log(`Calendar page URL: ${calendarUrl}`)

          // Extract property ID from URL (e.g., /manage/calendar/31917 or similar)
          const idMatch = calendarUrl.match(/\/(\d{4,})/)
          if (idMatch) {
            listingId = idMatch[1]
            listingUrl = `https://www.weneedavacation.com/Vacation-Rental/${listingId}`
            console.log(`Extracted listing ID: ${listingId}`)
          }
        }
      }

      // Method 3: Look for any link containing a listing ID number
      if (!listingUrl) {
        const allLinks = await page.$$('a[href*="/"]')
        for (const link of allLinks) {
          const href = await link.getAttribute('href')
          if (href) {
            const match = href.match(/\/(\d{5,})/)
            if (match) {
              listingId = match[1]
              listingUrl = `https://www.weneedavacation.com/Vacation-Rental/${listingId}`
              console.log(`Found listing ID in link: ${listingId}`)
              break
            }
          }
        }
      }

      // Extract property name if we found a URL
      if (listingUrl) {
        const idMatch = listingUrl.match(/\/(\d+)/)
        if (idMatch) {
          listingId = idMatch[1]
        }

        // Try to get property name from the page
        const nameElement = await page.$('h1, h2, .property-name, [class*="property"]')
        if (nameElement) {
          propertyName = await nameElement.textContent()
          propertyName = propertyName?.trim()
        }
      }

      if (listingUrl) {
        console.log(`Property detected: ${propertyName || 'Unknown'} (ID: ${listingId})`)
      } else {
        console.log('Could not auto-detect property. User will need to provide URL.')
      }

    } catch (detectError) {
      console.log('Property auto-detection failed:', detectError.message)
      // Continue anyway - login was successful
    }

    await browser.close()

    res.json({
      success: true,
      listingUrl: listingUrl,
      listingId: listingId,
      propertyName: propertyName
    })

  } catch (error) {
    console.error('Error during login capture:', error.message)

    if (browser) {
      await browser.close()
    }

    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

app.get('/api/auth/status', (req, res) => {
  const sessionPath = path.join(dataDir, 'session.json')

  if (fs.existsSync(sessionPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
      if (cookies && cookies.length > 0) {
        res.json({ loggedIn: true })
        return
      }
    } catch (error) {
      // If we can't read the file, treat as not logged in
    }
  }

  res.json({ loggedIn: false })
})

// UNIFIED WNAV IMPORT - Login + Scrape in one operation
// No URL required - navigates automatically after login
app.post('/api/wnav/import', async (req, res) => {
  let browser = null
  const sessionPath = path.join(dataDir, 'session.json')

  try {
    // Check if we have saved session cookies
    let savedCookies = null
    let useExistingSession = false

    if (fs.existsSync(sessionPath)) {
      try {
        savedCookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
        if (savedCookies && savedCookies.length > 0) {
          useExistingSession = true
          console.log('Found existing session, attempting to use saved cookies...')
        }
      } catch (e) {
        console.log('Could not read saved session, will require login')
      }
    }

    if (useExistingSession) {
      // Try to use existing session with headless browser
      console.log('Using saved session (headless)...')
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext()
      await context.addCookies(savedCookies)
      const page = await context.newPage()

      // Navigate to dashboard to verify session is still valid
      console.log('Verifying session...')
      await page.goto('https://www.weneedavacation.com/HC/HCWelcome.aspx', { waitUntil: 'networkidle' })

      // Check if we're still logged in (look for Calendar link or check URL)
      const currentUrl = page.url()
      const calendarLink = await page.$('a:has-text("Calendar")')

      if (!calendarLink || currentUrl.includes('Login')) {
        // Session expired, need to re-login
        console.log('Session expired, need to re-login...')
        await browser.close()
        browser = null
        useExistingSession = false
      } else {
        console.log('Session valid!')
        // Save dashboard HTML for debugging
        const dashboardHtml = await page.content()
        fs.writeFileSync(path.join(dataDir, 'dashboard.html'), dashboardHtml)
      }
    }

    // If no valid session, need to login manually
    if (!useExistingSession) {
      console.log('Opening browser for WNAV login...')

      browser = await chromium.launch({
        headless: false,
        slowMo: 100
      })

      const context = await browser.newContext()
      const page = await context.newPage()

      // Go to login page
      console.log('Navigating to WNAV login page...')
      await page.goto('https://www.weneedavacation.com/HC/Login.aspx')

      // Focus the username field so user can start typing immediately
      try {
        await page.waitForSelector('input[type="text"], input[name*="user"], input[id*="user"], #txtEmail', { timeout: 5000 })
        const usernameField = await page.$('input[type="text"], input[name*="user"], input[id*="user"], #txtEmail')
        if (usernameField) {
          await usernameField.focus()
          console.log('Focused username field')
        }
      } catch (e) {
        console.log('Could not focus username field automatically')
      }

      // Wait for user to log in
      console.log('Waiting for you to log in...')
      console.log('(Browser will proceed automatically after successful login)')

      await Promise.race([
        page.waitForURL('**/HC/HCWelcome.aspx**', { timeout: 300000 }),
        page.waitForSelector('text=Calendar and pricing', { timeout: 300000 }),
        page.waitForSelector('text=Calendar and Pricing', { timeout: 300000 }),
        page.waitForSelector('text=Calendar & Pricing', { timeout: 300000 })
      ])

      console.log('Login detected!')

      // Save session cookies for future use
      const cookies = await context.cookies()
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }
      fs.writeFileSync(sessionPath, JSON.stringify(cookies, null, 2))
      console.log('Session saved.')

      // Navigate to dashboard if not already there
      const currentUrl = page.url()
      if (!currentUrl.includes('HCWelcome')) {
        console.log('Navigating to Homeowner Center dashboard...')
        await page.goto('https://www.weneedavacation.com/HC/HCWelcome.aspx', { waitUntil: 'networkidle' })
      }

      // Save dashboard HTML for debugging
      const dashboardHtml = await page.content()
      fs.writeFileSync(path.join(dataDir, 'dashboard.html'), dashboardHtml)
    }

    // At this point we have a valid browser context - get the page
    const pages = browser.contexts()[0].pages()
    const page = pages[0]

    // Step 4: Find and click "Calendar and Pricing" link
    console.log('Looking for Calendar and Pricing link...')
    let calendarLink = await page.$('a:has-text("Calendar and pricing")') ||
                       await page.$('a:has-text("Calendar and Pricing")') ||
                       await page.$('a:has-text("Calendar & Pricing")') ||
                       await page.$('a:has-text("Calendar")')

    if (!calendarLink) {
      await browser.close()
      return res.status(404).json({
        success: false,
        error: 'Could not find Calendar and Pricing link in your Homeowner Center. Please ensure you have a property listed.'
      })
    }

    console.log('Clicking Calendar and Pricing link...')
    await calendarLink.click()
    await page.waitForLoadState('networkidle')

    // Step 5: Extract property info from the calendar page
    const calendarPageUrl = page.url()
    console.log(`Now on calendar page: ${calendarPageUrl}`)

    const calendarHtml = await page.content()
    fs.writeFileSync(path.join(dataDir, 'calendar-page.html'), calendarHtml)

    const pageTitle = await page.title()
    console.log(`Page title: ${pageTitle}`)

    // Extract property ID from URL if present
    const idMatch = calendarPageUrl.match(/\/(\d{4,})/)
    const listingId = idMatch ? idMatch[1] : 'default'
    console.log(`Property ID: ${listingId}`)

    // Try to get property name from page
    let propertyName = null
    try {
      propertyName = await page.$eval('h1, h2, .property-name, [class*="listing-title"]', el => el.textContent?.trim())
    } catch (e) {
      // Property name not found, use page title
      propertyName = pageTitle.replace(' - WeNeedAVacation.com', '').trim()
    }
    console.log(`Property name: ${propertyName || 'Unknown'}`)

    // Step 6: Scrape the calendar data
    console.log('Scraping calendar data...')
    const currentYear = new Date().getFullYear()

    const calendarData = await page.evaluate((targetYear) => {
      const allWeeks = new Map()

      // Find all price input fields - they have names like pw_YYYY_MM_DD
      const priceInputs = document.querySelectorAll('input[name^="pw_"]')

      priceInputs.forEach(input => {
        // Parse the input name: pw_YYYY_MM_DD
        const nameMatch = input.name.match(/pw_(\d{4})_(\d{1,2})_(\d{1,2})/)
        if (!nameMatch) return

        const year = parseInt(nameMatch[1])
        const month = parseInt(nameMatch[2]) - 1 // Convert to 0-indexed
        const day = parseInt(nameMatch[3])

        // Only include target year
        if (year !== targetYear) return

        // Get the price value
        const priceValue = parseInt(input.value) || 0
        if (priceValue === 0) return

        const price = `$${priceValue.toLocaleString()}`

        // Find the row this input is in to check availability
        const row = input.closest('tr')
        let hasBookedDay = false
        let hasAvailableDay = false

        if (row) {
          const dayCells = row.querySelectorAll('td')
          dayCells.forEach(cell => {
            const cellClass = cell.className.toLowerCase()
            if (cellClass.includes('booked') || cellClass.includes('unavail')) {
              hasBookedDay = true
            }
            if (cellClass.includes('avail')) {
              hasAvailableDay = true
            }

            const checkbox = cell.querySelector('input[type="checkbox"]')
            if (checkbox && checkbox.checked) {
              hasBookedDay = true
            } else if (checkbox && !checkbox.checked) {
              hasAvailableDay = true
            }
          })
        }

        let status = 'available'
        if (hasBookedDay && !hasAvailableDay) {
          status = 'booked'
        } else if (hasBookedDay && hasAvailableDay) {
          status = 'partial'
        }

        const startDate = new Date(year, month, day)
        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 7)

        const weekKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

        allWeeks.set(weekKey, {
          weekKey,
          startDate: {
            year: startDate.getFullYear(),
            month: startDate.getMonth(),
            day: startDate.getDate()
          },
          endDate: {
            year: endDate.getFullYear(),
            month: endDate.getMonth(),
            day: endDate.getDate()
          },
          price,
          status
        })
      })

      // Convert and sort
      const uniqueWeeks = Array.from(allWeeks.values()).sort((a, b) => {
        const dateA = new Date(a.startDate.year, a.startDate.month, a.startDate.day)
        const dateB = new Date(b.startDate.year, b.startDate.month, b.startDate.day)
        return dateA - dateB
      })

      // Group by month
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December']
      const monthsMap = {}

      uniqueWeeks.forEach(week => {
        const monthKey = `${week.startDate.year}-${week.startDate.month}`
        if (!monthsMap[monthKey]) {
          monthsMap[monthKey] = {
            month: monthNames[week.startDate.month],
            year: week.startDate.year,
            weeks: []
          }
        }
        monthsMap[monthKey].weeks.push(week)
      })

      const months = Object.values(monthsMap).sort((a, b) => {
        const aIdx = a.year * 12 + monthNames.indexOf(a.month)
        const bIdx = b.year * 12 + monthNames.indexOf(b.month)
        return aIdx - bIdx
      })

      return {
        weekStartDay: 6,
        months,
        targetYear,
        debug: {
          foundInputs: priceInputs.length,
          foundWeeks: allWeeks.size
        }
      }
    }, currentYear)

    console.log(`\nFound ${calendarData.debug.foundInputs} price inputs`)
    console.log(`Extracted ${calendarData.debug.foundWeeks} weeks for ${currentYear} from WNAV`)

    // Load existing data if any
    const calendarPath = path.join(dataDir, `calendar-${listingId}.json`)
    let existingData = null
    if (fs.existsSync(calendarPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(calendarPath, 'utf8'))
        console.log(`Loaded existing data with ${existingData.months?.length || 0} months`)
      } catch (e) {
        console.log('Could not load existing data, starting fresh')
      }
    }

    // Merge scraped data with existing data
    const { months: mergedMonths, stats: mergeStats } = mergeCalendarData(
      existingData?.months,
      calendarData.months,
      currentYear
    )

    console.log(`\nMerge results:`)
    console.log(`  Weeks from this scrape: ${mergeStats.weeksFromScrape}`)
    console.log(`  Weeks preserved from previous scrapes: ${mergeStats.weeksFromExisting}`)
    console.log(`  Missing weeks (no data): ${mergeStats.missingWeeks}`)

    // Save the calendar data
    fs.writeFileSync(calendarPath, JSON.stringify({
      listingId,
      propertyName,
      calendarPageUrl,
      pageTitle,
      scrapedAt: new Date().toISOString(),
      weekStartDay: calendarData.weekStartDay,
      months: mergedMonths,
      mergeStats
    }, null, 2))
    console.log(`Calendar data saved to: ${calendarPath}`)

    await browser.close()

    // Return everything the frontend needs
    res.json({
      success: true,
      listingId,
      propertyName,
      pageTitle,
      weekStartDay: calendarData.weekStartDay,
      months: mergedMonths,
      mergeStats,
      weeksImported: calendarData.debug.foundWeeks
    })

  } catch (error) {
    console.error('Error during WNAV import:', error.message)

    if (browser) {
      await browser.close()
    }

    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

// Helper: Generate all expected weeks for a year (Saturday to Saturday)
function generateAllWeeksForYear(year, weekStartDay = 6) {
  const weeks = []

  // Start from first Saturday of the year (or late December of previous year)
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
      const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`

      weeks.push({
        weekKey,
        startDate: {
          year: weekStart.getFullYear(),
          month: weekStart.getMonth(),
          day: weekStart.getDate()
        },
        endDate: {
          year: weekEnd.getFullYear(),
          month: weekEnd.getMonth(),
          day: weekEnd.getDate()
        }
      })
    }

    current.setDate(current.getDate() + 7)
  }

  return weeks
}

// Helper: Merge scraped data with existing saved data
function mergeCalendarData(existingMonths, scrapedMonths, targetYear) {
  // Build a map of all existing weeks by weekKey
  const existingWeeksMap = new Map()
  if (existingMonths && existingMonths.length > 0) {
    existingMonths.forEach(month => {
      month.weeks.forEach(week => {
        existingWeeksMap.set(week.weekKey, { ...week, source: 'existing' })
      })
    })
  }

  // Build a map of all scraped weeks by weekKey
  const scrapedWeeksMap = new Map()
  if (scrapedMonths && scrapedMonths.length > 0) {
    scrapedMonths.forEach(month => {
      month.weeks.forEach(week => {
        scrapedWeeksMap.set(week.weekKey, { ...week, source: 'scraped' })
      })
    })
  }

  // Merge: scraped takes precedence, but keep existing weeks that aren't in scrape
  const mergedWeeksMap = new Map()

  // First, add all existing weeks
  existingWeeksMap.forEach((week, key) => {
    mergedWeeksMap.set(key, week)
  })

  // Then, overlay scraped weeks (these take precedence)
  scrapedWeeksMap.forEach((week, key) => {
    mergedWeeksMap.set(key, week)
  })

  // Generate all expected weeks for the year to identify gaps
  const allExpectedWeeks = generateAllWeeksForYear(targetYear, 6)
  const missingWeeks = []

  allExpectedWeeks.forEach(expectedWeek => {
    if (!mergedWeeksMap.has(expectedWeek.weekKey)) {
      // This week is missing - add it with no data
      missingWeeks.push(expectedWeek.weekKey)
      mergedWeeksMap.set(expectedWeek.weekKey, {
        ...expectedWeek,
        price: '',
        status: 'unknown',
        source: 'missing',
        needsManualEntry: true
      })
    }
  })

  // Convert merged map to sorted array
  const mergedWeeks = Array.from(mergedWeeksMap.values()).sort((a, b) => {
    const dateA = new Date(a.startDate.year, a.startDate.month, a.startDate.day)
    const dateB = new Date(b.startDate.year, b.startDate.month, b.startDate.day)
    return dateA - dateB
  })

  // Group by month
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December']
  const monthsMap = {}

  mergedWeeks.forEach(week => {
    const monthKey = `${week.startDate.year}-${week.startDate.month}`
    if (!monthsMap[monthKey]) {
      monthsMap[monthKey] = {
        month: monthNames[week.startDate.month],
        year: week.startDate.year,
        weeks: []
      }
    }
    monthsMap[monthKey].weeks.push(week)
  })

  const months = Object.values(monthsMap).sort((a, b) => {
    const aIdx = a.year * 12 + monthNames.indexOf(a.month)
    const bIdx = b.year * 12 + monthNames.indexOf(b.month)
    return aIdx - bIdx
  })

  // Calculate merge statistics
  const stats = {
    totalWeeksInYear: allExpectedWeeks.length,
    weeksFromScrape: scrapedWeeksMap.size,
    weeksFromExisting: 0,
    missingWeeks: missingWeeks.length,
    missingWeekKeys: missingWeeks
  }

  // Count weeks that came from existing data (not overwritten by scrape)
  existingWeeksMap.forEach((week, key) => {
    if (!scrapedWeeksMap.has(key)) {
      stats.weeksFromExisting++
    }
  })

  return { months, stats }
}

app.post('/api/scrape/calendar', async (req, res) => {
  const { url } = req.body
  let browser = null

  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required' })
  }

  const sessionPath = path.join(dataDir, 'session.json')
  if (!fs.existsSync(sessionPath)) {
    return res.status(401).json({ success: false, error: 'Not logged in. Please log in first.' })
  }

  try {
    const listingIdMatch = url.match(/(\d+)\/?$/)
    const listingId = listingIdMatch ? listingIdMatch[1] : null

    if (!listingId) {
      return res.status(400).json({ success: false, error: 'Could not extract listing ID from URL' })
    }

    console.log(`Looking for property with listing ID: ${listingId}`)

    // SAFEGUARD 2: Load existing saved data for this property
    const calendarPath = path.join(dataDir, `calendar-${listingId}.json`)
    let existingData = null
    if (fs.existsSync(calendarPath)) {
      try {
        existingData = JSON.parse(fs.readFileSync(calendarPath, 'utf8'))
        console.log(`Loaded existing data with ${existingData.months?.length || 0} months`)
      } catch (e) {
        console.log('Could not load existing data, starting fresh')
      }
    }

    console.log('Loading saved session...')
    const cookies = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))

    console.log('Opening browser to scrape calendar...')

    browser = await chromium.launch({
      headless: true
    })

    const context = await browser.newContext()
    await context.addCookies(cookies)

    const page = await context.newPage()

    // Step 1: Go to the owner dashboard
    console.log('Navigating to owner dashboard...')
    await page.goto('https://www.weneedavacation.com/HC/HCWelcome.aspx', { waitUntil: 'networkidle' })

    // Step 2: Find the "Calendar and Pricing" link
    console.log('Looking for Calendar and Pricing link...')

    const dashboardHtml = await page.content()
    fs.writeFileSync(path.join(dataDir, 'dashboard.html'), dashboardHtml)

    let calendarLink = null
    calendarLink = await page.$(`a[href*="${listingId}"][href*="Calendar" i]`)
    if (!calendarLink) {
      calendarLink = await page.$('a:has-text("Calendar and Pricing")')
    }
    if (!calendarLink) {
      calendarLink = await page.$('a:has-text("Calendar & Pricing")')
    }
    if (!calendarLink) {
      calendarLink = await page.$('a:has-text("Calendar")')
    }

    if (!calendarLink) {
      await browser.close()
      return res.status(404).json({
        success: false,
        error: 'Could not find Calendar and Pricing link.'
      })
    }

    console.log('Clicking Calendar and Pricing link...')
    await calendarLink.click()
    await page.waitForLoadState('networkidle')

    const calendarPageUrl = page.url()
    console.log(`Now on: ${calendarPageUrl}`)

    const calendarHtml = await page.content()
    fs.writeFileSync(path.join(dataDir, 'calendar-page.html'), calendarHtml)

    const title = await page.title()
    console.log(`Page title: ${title}`)

    // Extract week-by-week calendar data from the owner's calendar page
    // Only import current year - next year will be generated by the app
    const currentYear = new Date().getFullYear()
    const calendarData = await page.evaluate((targetYear) => {
      const allWeeks = new Map()

      // Find all price input fields - they have names like pw_YYYY_MM_DD
      const priceInputs = document.querySelectorAll('input[name^="pw_"]')

      priceInputs.forEach(input => {
        // Parse the input name: pw_YYYY_MM_DD
        const nameMatch = input.name.match(/pw_(\d{4})_(\d{1,2})_(\d{1,2})/)
        if (!nameMatch) return

        const year = parseInt(nameMatch[1])
        const month = parseInt(nameMatch[2]) - 1 // Convert to 0-indexed
        const day = parseInt(nameMatch[3])

        // Only include target year
        if (year !== targetYear) return

        // Get the price value
        const priceValue = parseInt(input.value) || 0
        if (priceValue === 0) return

        const price = `$${priceValue.toLocaleString()}`

        // Find the row this input is in to check availability
        const row = input.closest('tr')
        let hasBookedDay = false
        let hasAvailableDay = false

        if (row) {
          const dayCells = row.querySelectorAll('td')
          dayCells.forEach(cell => {
            const cellClass = cell.className.toLowerCase()
            if (cellClass.includes('booked') || cellClass.includes('unavail')) {
              hasBookedDay = true
            }
            if (cellClass.includes('avail')) {
              hasAvailableDay = true
            }

            const checkbox = cell.querySelector('input[type="checkbox"]')
            if (checkbox && checkbox.checked) {
              hasBookedDay = true
            } else if (checkbox && !checkbox.checked) {
              hasAvailableDay = true
            }
          })
        }

        let status = 'available'
        if (hasBookedDay && !hasAvailableDay) {
          status = 'booked'
        } else if (hasBookedDay && hasAvailableDay) {
          status = 'partial'
        }

        const startDate = new Date(year, month, day)
        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + 7)

        const weekKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`

        allWeeks.set(weekKey, {
          weekKey,
          startDate: {
            year: startDate.getFullYear(),
            month: startDate.getMonth(),
            day: startDate.getDate()
          },
          endDate: {
            year: endDate.getFullYear(),
            month: endDate.getMonth(),
            day: endDate.getDate()
          },
          price,
          status
        })
      })

      // Convert and sort
      const uniqueWeeks = Array.from(allWeeks.values()).sort((a, b) => {
        const dateA = new Date(a.startDate.year, a.startDate.month, a.startDate.day)
        const dateB = new Date(b.startDate.year, b.startDate.month, b.startDate.day)
        return dateA - dateB
      })

      // Group by month
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December']
      const monthsMap = {}

      uniqueWeeks.forEach(week => {
        const monthKey = `${week.startDate.year}-${week.startDate.month}`
        if (!monthsMap[monthKey]) {
          monthsMap[monthKey] = {
            month: monthNames[week.startDate.month],
            year: week.startDate.year,
            weeks: []
          }
        }
        monthsMap[monthKey].weeks.push(week)
      })

      const months = Object.values(monthsMap).sort((a, b) => {
        const aIdx = a.year * 12 + monthNames.indexOf(a.month)
        const bIdx = b.year * 12 + monthNames.indexOf(b.month)
        return aIdx - bIdx
      })

      const weekStartDay = 6

      return {
        weekStartDay,
        months,
        targetYear,
        debug: {
          foundInputs: priceInputs.length,
          foundWeeks: allWeeks.size
        }
      }
    }, currentYear)

    console.log(`\nFound ${calendarData.debug.foundInputs} price inputs`)
    console.log(`Extracted ${calendarData.debug.foundWeeks} weeks for ${currentYear} from WNAV`)

    // SAFEGUARD 2: Merge scraped data with existing data
    const { months: mergedMonths, stats: mergeStats } = mergeCalendarData(
      existingData?.months,
      calendarData.months,
      currentYear
    )

    console.log(`\nMerge results:`)
    console.log(`  Weeks from this scrape: ${mergeStats.weeksFromScrape}`)
    console.log(`  Weeks preserved from previous scrapes: ${mergeStats.weeksFromExisting}`)
    console.log(`  Missing weeks (no data): ${mergeStats.missingWeeks}`)
    console.log(`  Total weeks in merged calendar: ${mergeStats.totalWeeksInYear - mergeStats.missingWeeks + mergeStats.missingWeeks}`)

    console.log(`Grouped into ${mergedMonths.length} months`)
    mergedMonths.forEach(m => {
      const missingInMonth = m.weeks.filter(w => w.needsManualEntry).length
      console.log(`  ${m.month} ${m.year}: ${m.weeks.length} weeks${missingInMonth > 0 ? ` (${missingInMonth} missing)` : ''}`)
    })

    // Save the merged calendar data
    fs.writeFileSync(calendarPath, JSON.stringify({
      listingId,
      listingUrl: url,
      calendarPageUrl,
      pageTitle: title,
      scrapedAt: new Date().toISOString(),
      weekStartDay: calendarData.weekStartDay,
      months: mergedMonths,
      mergeStats
    }, null, 2))
    console.log(`Calendar data saved to: ${calendarPath}`)

    await browser.close()

    // SAFEGUARD 4: Include merge stats in response for frontend warning
    res.json({
      success: true,
      listingId,
      pageTitle: title,
      weekStartDay: calendarData.weekStartDay,
      months: mergedMonths,
      mergeStats
    })

  } catch (error) {
    console.error('Error scraping calendar:', error.message)

    if (browser) {
      await browser.close()
    }

    res.status(500).json({
      success: false,
      error: error.message
    })
  }
})

app.post('/api/calendar/save', (req, res) => {
  const { listingId, months } = req.body

  if (!listingId || !months) {
    return res.status(400).json({ success: false, error: 'listingId and months are required' })
  }

  try {
    const calendarPath = path.join(dataDir, `calendar-${listingId}.json`)

    let existingData = {}
    if (fs.existsSync(calendarPath)) {
      existingData = JSON.parse(fs.readFileSync(calendarPath, 'utf8'))
    }

    const updatedData = {
      ...existingData,
      months,
      lastModified: new Date().toISOString()
    }

    fs.writeFileSync(calendarPath, JSON.stringify(updatedData, null, 2))
    console.log(`Calendar data saved for listing ${listingId}`)

    res.json({ success: true })
  } catch (error) {
    console.error('Error saving calendar:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.get('/api/calendar/:listingId', (req, res) => {
  const { listingId } = req.params

  try {
    const calendarPath = path.join(dataDir, `calendar-${listingId}.json`)

    if (!fs.existsSync(calendarPath)) {
      return res.status(404).json({ success: false, error: 'No saved calendar data found' })
    }

    const data = JSON.parse(fs.readFileSync(calendarPath, 'utf8'))
    res.json({ success: true, ...data })
  } catch (error) {
    console.error('Error loading calendar:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// ============ USER SETTINGS ENDPOINTS ============

// Get user settings (returns null if no settings exist yet)
app.get('/api/settings', (req, res) => {
  try {
    const settingsPath = path.join(dataDir, 'user-settings.json')

    if (!fs.existsSync(settingsPath)) {
      return res.json({ success: true, settings: null })
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    res.json({ success: true, settings })
  } catch (error) {
    console.error('Error loading settings:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Save user settings
app.post('/api/settings', (req, res) => {
  const { settings } = req.body

  if (!settings) {
    return res.status(400).json({ success: false, error: 'Settings object is required' })
  }

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    const settingsPath = path.join(dataDir, 'user-settings.json')

    // Add timestamp
    const settingsToSave = {
      ...settings,
      lastModified: new Date().toISOString()
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settingsToSave, null, 2))
    console.log('User settings saved')

    res.json({ success: true })
  } catch (error) {
    console.error('Error saving settings:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Export all settings as JSON backup
app.get('/api/settings/export', (req, res) => {
  try {
    const settingsPath = path.join(dataDir, 'user-settings.json')

    if (!fs.existsSync(settingsPath)) {
      return res.status(404).json({ success: false, error: 'No settings to export' })
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))

    // Include any saved calendar data
    const exportData = {
      exportedAt: new Date().toISOString(),
      settings,
      calendars: []
    }

    // Find all calendar files
    const files = fs.readdirSync(dataDir)
    files.forEach(file => {
      if (file.startsWith('calendar-') && file.endsWith('.json')) {
        try {
          const calData = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'))
          exportData.calendars.push(calData)
        } catch (e) {
          console.error(`Error reading ${file}:`, e.message)
        }
      }
    })

    res.json({ success: true, data: exportData })
  } catch (error) {
    console.error('Error exporting settings:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Import settings from JSON backup
app.post('/api/settings/import', (req, res) => {
  const { data } = req.body

  if (!data || !data.settings) {
    return res.status(400).json({ success: false, error: 'Invalid import data' })
  }

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }

    // Save settings
    const settingsPath = path.join(dataDir, 'user-settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify(data.settings, null, 2))

    // Restore calendars if present
    if (data.calendars && Array.isArray(data.calendars)) {
      data.calendars.forEach(cal => {
        if (cal.listingId) {
          const calPath = path.join(dataDir, `calendar-${cal.listingId}.json`)
          fs.writeFileSync(calPath, JSON.stringify(cal, null, 2))
        }
      })
    }

    console.log('Settings imported successfully')
    res.json({ success: true })
  } catch (error) {
    console.error('Error importing settings:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Reset settings to defaults
app.delete('/api/settings', (req, res) => {
  try {
    const settingsPath = path.join(dataDir, 'user-settings.json')

    if (fs.existsSync(settingsPath)) {
      fs.unlinkSync(settingsPath)
    }

    console.log('Settings reset to defaults')
    res.json({ success: true })
  } catch (error) {
    console.error('Error resetting settings:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Save entry guide progress
app.post('/api/progress', (req, res) => {
  const { platform, completedWeeks } = req.body

  try {
    const progressPath = path.join(dataDir, 'entry-progress.json')

    let progress = {}
    if (fs.existsSync(progressPath)) {
      progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'))
    }

    progress[platform] = {
      completedWeeks: completedWeeks || [],
      lastUpdated: new Date().toISOString()
    }

    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2))
    res.json({ success: true })
  } catch (error) {
    console.error('Error saving progress:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get entry guide progress
app.get('/api/progress', (req, res) => {
  try {
    const progressPath = path.join(dataDir, 'entry-progress.json')

    if (!fs.existsSync(progressPath)) {
      return res.json({ success: true, progress: {} })
    }

    const progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'))
    res.json({ success: true, progress })
  } catch (error) {
    console.error('Error loading progress:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Reset entry guide progress
app.delete('/api/progress', (req, res) => {
  try {
    const progressPath = path.join(dataDir, 'entry-progress.json')

    if (fs.existsSync(progressPath)) {
      fs.unlinkSync(progressPath)
    }

    res.json({ success: true })
  } catch (error) {
    console.error('Error resetting progress:', error.message)
    res.status(500).json({ success: false, error: error.message })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
