/**
 * STR Pricing Updater
 * (c) 2026 by Matthew J Rosenberg
 */

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import ExcelJS from 'exceljs'
import {
  mapWeeksByHolidays,
  detectConflicts,
  buildHolidayAnchorTable
} from './utils/weekMapping.js'
import {
  parsePrice,
  formatPrice,
  calculateListPrice,
  calculateNightlyRates,
  calculateAdjustedPrice,
  DEFAULT_NIGHTLY_WEIGHTS,
  PLATFORM_COMMISSION_RATES
} from './utils/calculations.js'
import { getHolidaysForYear } from './utils/holidays.js'

// Default settings structure
const DEFAULT_SETTINGS = {
  setupComplete: false,
  pricingSource: 'wnav', // 'wnav' or 'manual'
  weekStartDay: 6, // Saturday
  platforms: {
    wnav: { enabled: true, commission: 0 },
    airbnb: { enabled: false, commission: 0.155, feeModel: 'host-only', lastVerified: null },
    vrbo: { enabled: false, commission: 0.08, feeModel: 'pay-per-booking', lastVerified: null },
    custom: []
  },
  nightlyWeights: DEFAULT_NIGHTLY_WEIGHTS,
  seasons: [
    { id: 1, name: 'Off-Peak Winter', startMonth: 1, startDay: 1, endMonth: 4, endDay: 30, percentage: 0, weeklyOnly: false, closedToGuests: false },
    { id: 2, name: 'Spring Shoulder', startMonth: 5, startDay: 1, endMonth: 5, endDay: 31, percentage: 0, weeklyOnly: false, closedToGuests: false },
    { id: 3, name: 'Peak Summer', startMonth: 6, startDay: 1, endMonth: 8, endDay: 31, percentage: 0, weeklyOnly: false, closedToGuests: false },
    { id: 4, name: 'Fall Shoulder', startMonth: 9, startDay: 1, endMonth: 10, endDay: 31, percentage: 0, weeklyOnly: false, closedToGuests: false },
    { id: 5, name: 'Off-Peak Winter', startMonth: 11, startDay: 1, endMonth: 12, endDay: 31, percentage: 0, weeklyOnly: false, closedToGuests: false }
  ],
  anchors: [] // Unified anchor structure (holidays + custom)
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Helper function to format date as YYYY-MM-DD
function formatDateISO(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Create default holiday anchors for source and target years
function createDefaultAnchors(sourceYear, targetYear) {
  const sourceHolidays = getHolidaysForYear(sourceYear)
  const targetHolidays = getHolidaysForYear(targetYear)

  const holidayMap = [
    { id: 'memorial', key: 'memorialDay', name: 'Memorial Day' },
    { id: 'july4', key: 'july4th', name: 'July 4th' },
    { id: 'labor', key: 'laborDay', name: 'Labor Day' },
    { id: 'thanksgiving', key: 'thanksgiving', name: 'Thanksgiving' },
    { id: 'christmas', key: 'christmas', name: 'Christmas' },
    { id: 'newyear', key: 'newYearsDay', name: "New Year's Day" }
  ]

  return holidayMap.map(h => ({
    id: h.id,
    name: h.name,
    type: 'holiday',
    enabled: true,
    sourceDate: formatDateISO(sourceHolidays[h.key].date),
    targetDate: formatDateISO(targetHolidays[h.key].date)
  }))
}

// Migrate old customAnchors format to new unified anchors format
function migrateAnchors(oldAnchors, sourceYear, targetYear) {
  if (!oldAnchors || oldAnchors.length === 0) {
    // No old data - return default holidays
    return createDefaultAnchors(sourceYear, targetYear)
  }

  // Check if already migrated (has 'type' field)
  if (oldAnchors[0]?.type) {
    return oldAnchors
  }

  // Migrate old format {key, name, month} to new format
  const sourceHolidays = getHolidaysForYear(sourceYear)
  const targetHolidays = getHolidaysForYear(targetYear)

  const migrated = []

  // Holiday key mapping
  const keyMap = {
    'memorial': 'memorialDay',
    'july4': 'july4th',
    'labor': 'laborDay',
    'thanksgiving': 'thanksgiving',
    'christmas': 'christmas',
    'newyear': 'newYearsDay'
  }

  oldAnchors.forEach(anchor => {
    if (anchor.key && keyMap[anchor.key]) {
      // It's a holiday anchor
      const holidayKey = keyMap[anchor.key]
      migrated.push({
        id: anchor.key,
        name: anchor.name,
        type: 'holiday',
        enabled: true,
        sourceDate: formatDateISO(sourceHolidays[holidayKey].date),
        targetDate: formatDateISO(targetHolidays[holidayKey].date)
      })
    } else if (anchor.label && anchor.sourceDate && anchor.targetDate) {
      // It's a custom anchor
      migrated.push({
        id: anchor.id || `custom_${Date.now()}_${Math.random()}`,
        name: anchor.label,
        type: 'custom',
        enabled: true,
        sourceDate: anchor.sourceDate,
        targetDate: anchor.targetDate
      })
    }
  })

  return migrated
}
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Helper: Select all on focus when value is 0 (for numeric inputs)
function handleZeroFieldFocus(e) {
  const val = e.target.value
  // Check if value is '0', 0, empty, or falsy (but not empty string for optional fields)
  if (val === '0' || val === 0 || Number(val) === 0) {
    e.target.select()
  }
}

// Reusable NumericInput component that clears zeros on focus
function NumericInput({ value, onChange, className = '', step = 1, min, max, ...props }) {
  return (
    <input
      type="number"
      value={value}
      onChange={onChange}
      onFocus={handleZeroFieldFocus}
      step={step}
      min={min}
      max={max}
      className={className}
      {...props}
    />
  )
}

function App() {
  // Core app state
  const [appState, setAppState] = useState('loading') // 'loading', 'setup', 'main'
  const [activeTab, setActiveTab] = useState('import') // 'import', 'planning', 'platforms', 'guide', 'settings'
  const [settings, setSettings] = useState(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  // Setup wizard state
  const [setupStep, setSetupStep] = useState(1)
  const [setupData, setSetupData] = useState({
    pricingSource: 'wnav',
    platforms: {
      wnav: true,
      airbnb: false,
      vrbo: false,
      other: false
    },
    airbnbFeeModel: 'host-only',
    airbnbCommission: 15.5,
    vrboFeeModel: 'pay-per-booking',
    vrboCommission: 8,
    vrboIncludeTax: false,
    vrboTaxRate: 0,
    customPlatforms: [],
    nightlyWeights: { ...DEFAULT_SETTINGS.nightlyWeights },
    seasons: [...DEFAULT_SETTINGS.seasons],
    // Default holiday anchors - all enabled by default
    anchors: createDefaultAnchors(new Date().getFullYear(), new Date().getFullYear() + 1)
  })

  // WNAV state
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [loginState, setLoginState] = useState('idle')
  const [loginError, setLoginError] = useState('')
  const [listingUrl, setListingUrl] = useState('')
  const [propertyName, setPropertyName] = useState('')
  const [scrapeState, setScrapeState] = useState('idle')
  const [scrapeError, setScrapeError] = useState('')
  const [listingId, setListingId] = useState(null)
  const [pageTitle, setPageTitle] = useState('')

  // Calendar data state
  const [months, setMonths] = useState([])
  const [expandedMonths, setExpandedMonths] = useState({})
  const [hasChanges, setHasChanges] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [mergeStats, setMergeStats] = useState(null)
  const [showMissingWeeksList, setShowMissingWeeksList] = useState(false)

  // Year planning state
  const [sourceYear, setSourceYear] = useState(null)
  const [targetYear, setTargetYear] = useState(null)
  const [showYearPlanning, setShowYearPlanning] = useState(true)
  const [yearPlanningApplied, setYearPlanningApplied] = useState(false)
  const [conflictResolutions, setConflictResolutions] = useState({})
  const [showMissingDataModal, setShowMissingDataModal] = useState(false)
  const [missingWeeksForModal, setMissingWeeksForModal] = useState([])
  const [missingDataModalContext, setMissingDataModalContext] = useState('planning') // 'planning' or 'platforms'
  const [referenceYear, setReferenceYear] = useState(null)
  const [referencePrices, setReferencePrices] = useState({})
  const [originalSourceMonths, setOriginalSourceMonths] = useState([]) // Preserve source data after year planning
  const [customProposedPrices, setCustomProposedPrices] = useState({}) // weekKey -> price
  const [showHolidayAnchors, setShowHolidayAnchors] = useState(false) // Collapsed by default
  const [customPlatformPrices, setCustomPlatformPrices] = useState({}) // `${weekKey}_${platformKey}` -> price

  // Custom anchors state
  const [showAnchorEditor, setShowAnchorEditor] = useState(false)
  const [isAddingAnchor, setIsAddingAnchor] = useState(false)
  const [newAnchorLabel, setNewAnchorLabel] = useState('')
  const [newAnchorSourceDate, setNewAnchorSourceDate] = useState('')
  const [newAnchorTargetDate, setNewAnchorTargetDate] = useState('')

  // Season editor state
  const [isAddingSeason, setIsAddingSeason] = useState(false)

  // Settings section save feedback
  const [sectionSaved, setSectionSaved] = useState({}) // { sectionName: timestamp }

  // Entry guide progress state
  const [entryProgress, setEntryProgress] = useState({})
  const [expandedPlatformSeasons, setExpandedPlatformSeasons] = useState({}) // seasonId -> boolean

  // Manual entry state
  const [manualYear, setManualYear] = useState(new Date().getFullYear())
  const [manualPrices, setManualPrices] = useState({}) // weekKey -> price
  const [useStandardCalendarWeeks, setUseStandardCalendarWeeks] = useState(false)

  // Test mode state
  const [originalTestData, setOriginalTestData] = useState(null)
  const [isTestMode, setIsTestMode] = useState(false)
  const [showTestingTools, setShowTestingTools] = useState(false)
  const [hasValidSession, setHasValidSession] = useState(false) // True only if actual session exists

  const isInitialLoad = useRef(true)

  // ============ SETTINGS PERSISTENCE ============

  // Load settings on mount
  useEffect(() => {
    loadSettings()
    checkLoginStatus()
    loadEntryProgress()
  }, [])

  // Scroll to top when switching tabs
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeTab])

  async function loadSettings() {
    try {
      const response = await fetch('/api/settings')
      const data = await response.json()

      if (data.success && data.settings) {
        const loadedSettings = data.settings

        // Migrate old customAnchors to new unified anchors format
        if (loadedSettings.customAnchors && !loadedSettings.anchors) {
          const sourceYear = new Date().getFullYear()
          const targetYear = sourceYear + 1
          loadedSettings.anchors = migrateAnchors(loadedSettings.customAnchors, sourceYear, targetYear)
          delete loadedSettings.customAnchors
        }

        // Ensure anchors exist (create defaults if missing)
        if (!loadedSettings.anchors || loadedSettings.anchors.length === 0) {
          const sourceYear = new Date().getFullYear()
          const targetYear = sourceYear + 1
          loadedSettings.anchors = createDefaultAnchors(sourceYear, targetYear)
        }

        setSettings(loadedSettings)
        setAppState(loadedSettings.setupComplete ? 'main' : 'setup')

        // Check for 90-day verification reminder
        if (loadedSettings.setupComplete) {
          checkVerificationReminder(loadedSettings)
        }
      } else {
        // No settings exist, show setup wizard
        setSettings(null)
        setAppState('setup')
      }
      setSettingsLoaded(true)
    } catch (error) {
      console.error('Failed to load settings:', error)
      setSettings(null)
      setAppState('setup')
      setSettingsLoaded(true)
    }
  }

  async function saveSettings(newSettings) {
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings })
      })
      const data = await response.json()
      if (data.success) {
        setSettings(newSettings)
        // Show brief "Saved" indicator
        setSettingsSaved(true)
        setTimeout(() => setSettingsSaved(false), 1500)
        return true
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
    }
    return false
  }

  async function loadEntryProgress() {
    try {
      const response = await fetch('/api/progress')
      const data = await response.json()
      if (data.success) {
        setEntryProgress(data.progress || {})
      }
    } catch (error) {
      console.error('Failed to load entry progress:', error)
    }
  }

  async function saveEntryProgress(platform, completedWeeks) {
    try {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, completedWeeks })
      })
      setEntryProgress(prev => ({
        ...prev,
        [platform]: { completedWeeks, lastUpdated: new Date().toISOString() }
      }))
    } catch (error) {
      console.error('Failed to save entry progress:', error)
    }
  }

  function checkVerificationReminder(userSettings) {
    const platforms = userSettings.platforms
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    let needsReminder = false
    if (platforms.airbnb?.enabled && platforms.airbnb.lastVerified) {
      const lastVerified = new Date(platforms.airbnb.lastVerified)
      if (lastVerified < ninetyDaysAgo) needsReminder = true
    }
    if (platforms.vrbo?.enabled && platforms.vrbo.lastVerified) {
      const lastVerified = new Date(platforms.vrbo.lastVerified)
      if (lastVerified < ninetyDaysAgo) needsReminder = true
    }

    // Could show a reminder modal here
  }

  // ============ SETUP WIZARD ============

  function renderSetupWizard() {
    const totalSteps = calculateTotalSteps()

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
        <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full overflow-hidden">
          {/* Progress bar */}
          <div className="bg-gray-100 px-6 py-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
              <span>Step {Math.min(setupStep, totalSteps)} of {totalSteps}</span>
              <span>{Math.min(100, Math.round((setupStep / totalSteps) * 100))}% complete</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.min(100, (setupStep / totalSteps) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-8">
            {setupStep === 1 && renderWelcomeStep()}
            {setupStep === 2 && renderPricingSourceStep()}
            {setupStep === 3 && renderPlatformSelectionStep()}
            {setupStep === 4 && setupData.platforms.airbnb && renderAirbnbSettingsStep()}
            {setupStep === 4 && !setupData.platforms.airbnb && setupData.platforms.vrbo && renderVrboSettingsStep()}
            {setupStep === 4 && !setupData.platforms.airbnb && !setupData.platforms.vrbo && setupData.platforms.other && renderCustomPlatformStep()}
            {setupStep === 4 && !setupData.platforms.airbnb && !setupData.platforms.vrbo && !setupData.platforms.other && renderNightlyWeightsStep()}
            {setupStep === 5 && setupData.platforms.airbnb && setupData.platforms.vrbo && renderVrboSettingsStep()}
            {setupStep === 5 && setupData.platforms.airbnb && !setupData.platforms.vrbo && setupData.platforms.other && renderCustomPlatformStep()}
            {setupStep === 5 && setupData.platforms.airbnb && !setupData.platforms.vrbo && !setupData.platforms.other && renderNightlyWeightsStep()}
            {setupStep === 5 && !setupData.platforms.airbnb && setupData.platforms.vrbo && setupData.platforms.other && renderCustomPlatformStep()}
            {setupStep === 5 && !setupData.platforms.airbnb && setupData.platforms.vrbo && !setupData.platforms.other && renderNightlyWeightsStep()}
            {setupStep === 6 && renderDynamicStep6()}
            {setupStep === 7 && renderDynamicStep7()}
            {setupStep === 8 && renderDynamicStep8()}
            {setupStep === 9 && renderSeasonsSetupStep()}
            {setupStep === 10 && renderAnchorsSetupStep()}
            {setupStep >= 11 && renderSetupCompleteStep()}
          </div>
        </div>
      </div>
    )
  }

  function calculateTotalSteps() {
    // Fixed total: steps 1-11 are used (Welcome through Complete)
    // The actual steps shown depend on platform selection, but max is always 11
    return 11
  }

  function renderWelcomeStep() {
    return (
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">Welcome to STR Pricing Updater</h1>
        <p className="text-gray-600 mb-6 leading-relaxed">
          This tool helps you set consistent pricing across vacation rental platforms so you don't lose money to commissions.
        </p>
        <div className="bg-blue-50 rounded-lg p-4 mb-6 text-left">
          <p className="text-blue-800 text-sm">
            <strong>The goal:</strong> When Platform A charges 0% and Platform B charges 15%, you need to list higher on Platform B to take home the same amount.
          </p>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <p className="text-gray-600 text-sm">
            All data you enter will be saved locally on your computer. This setup wizard is a one-time process, but you can always change your settings later.
          </p>
        </div>
        <button
          onClick={() => setSetupStep(2)}
          className="py-3 px-8 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
        >
          Get Started
        </button>
      </div>
    )
  }

  function renderPricingSourceStep() {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Where do you want to pull your base pricing from?</h2>
        <p className="text-gray-500 text-sm mb-6">
          "Base pricing" means what you want to NET (take home) before platform commissions. We'll calculate what to LIST on each platform.
        </p>

        <div className="space-y-3 mb-6">
          <label className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.pricingSource === 'wnav' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="radio"
              name="pricingSource"
              checked={setupData.pricingSource === 'wnav'}
              onChange={() => setSetupData(d => ({ ...d, pricingSource: 'wnav' }))}
              className="mt-1 w-5 h-5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-gray-800">WeNeedAVacation (WNAV)</div>
              <div className="text-sm text-gray-500">Import pricing from your WNAV owner dashboard</div>
            </div>
          </label>

          <label className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.pricingSource === 'manual' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="radio"
              name="pricingSource"
              checked={setupData.pricingSource === 'manual'}
              onChange={() => setSetupData(d => ({ ...d, pricingSource: 'manual' }))}
              className="mt-1 w-5 h-5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-gray-800">Manual Entry</div>
              <div className="text-sm text-gray-500">I'll enter my target weekly rates myself</div>
            </div>
          </label>
        </div>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(1)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(3)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderPlatformSelectionStep() {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Which platforms do you list on?</h2>
        <p className="text-gray-500 text-sm mb-6">Select all that apply</p>

        <div className="space-y-3 mb-6">
          <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.platforms.wnav ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="checkbox"
              checked={setupData.platforms.wnav}
              onChange={(e) => setSetupData(d => ({ ...d, platforms: { ...d.platforms, wnav: e.target.checked } }))}
              className="w-5 h-5 text-blue-600 rounded"
            />
            <div>
              <div className="font-semibold text-gray-800">WeNeedAVacation (WNAV)</div>
              <div className="text-sm text-gray-500">0% commission</div>
            </div>
          </label>

          <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.platforms.airbnb ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="checkbox"
              checked={setupData.platforms.airbnb}
              onChange={(e) => setSetupData(d => ({ ...d, platforms: { ...d.platforms, airbnb: e.target.checked } }))}
              className="w-5 h-5 text-blue-600 rounded"
            />
            <div>
              <div className="font-semibold text-gray-800">Airbnb</div>
              <div className="text-sm text-gray-500">Commission varies by fee structure</div>
            </div>
          </label>

          <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.platforms.vrbo ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="checkbox"
              checked={setupData.platforms.vrbo}
              onChange={(e) => setSetupData(d => ({ ...d, platforms: { ...d.platforms, vrbo: e.target.checked } }))}
              className="w-5 h-5 text-blue-600 rounded"
            />
            <div>
              <div className="font-semibold text-gray-800">Vrbo</div>
              <div className="text-sm text-gray-500">Commission varies by plan</div>
            </div>
          </label>

          <label className={`flex items-center gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.platforms.other ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="checkbox"
              checked={setupData.platforms.other}
              onChange={(e) => setSetupData(d => ({ ...d, platforms: { ...d.platforms, other: e.target.checked } }))}
              className="w-5 h-5 text-blue-600 rounded"
            />
            <div>
              <div className="font-semibold text-gray-800">Other Platform</div>
              <div className="text-sm text-gray-500">Custom platform with your own commission rate</div>
            </div>
          </label>
        </div>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(2)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(4)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderAirbnbSettingsStep() {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Airbnb Fee Structure</h2>
        <p className="text-gray-500 text-sm mb-6">
          Airbnb takes a commission from hosts. The amount depends on your account type.
        </p>

        <div className="space-y-3 mb-6">
          <label className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.airbnbFeeModel === 'host-only' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="radio"
              name="airbnbFeeModel"
              checked={setupData.airbnbFeeModel === 'host-only'}
              onChange={() => setSetupData(d => ({ ...d, airbnbFeeModel: 'host-only', airbnbCommission: 15.5 }))}
              className="mt-1 w-5 h-5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-gray-800">Host-only fee (15.5%)</div>
              <div className="text-sm text-gray-500">This is what most hosts pay. If you're not sure, choose this one.</div>
            </div>
          </label>

          <label className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.airbnbFeeModel === 'split' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="radio"
              name="airbnbFeeModel"
              checked={setupData.airbnbFeeModel === 'split'}
              onChange={() => setSetupData(d => ({ ...d, airbnbFeeModel: 'split', airbnbCommission: 3 }))}
              className="mt-1 w-5 h-5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-gray-800">Split fee (3% host + ~14% guest)</div>
              <div className="text-sm text-gray-500">Older fee structure, still available to some individual US/Canada hosts who haven't switched.</div>
            </div>
          </label>
        </div>

        <div className="mb-6">
          <label className="block text-gray-700 font-medium mb-2">Your Airbnb commission rate:</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              value={setupData.airbnbCommission}
              onChange={(e) => setSetupData(d => ({ ...d, airbnbCommission: parseFloat(e.target.value) || 0 }))}
              onFocus={handleZeroFieldFocus}
              className="w-24 p-2 border border-gray-300 rounded-lg text-right"
            />
            <span className="text-gray-500">%</span>
          </div>
        </div>

        <div className="bg-yellow-50 rounded-lg p-4 mb-6">
          <p className="text-yellow-800 text-sm">
            <strong>Why this matters:</strong> If you want to NET $3,000 and Airbnb takes {setupData.airbnbCommission}%, you need to LIST ${Math.ceil(3000 / (1 - setupData.airbnbCommission / 100)).toLocaleString()} on Airbnb. We do this math for you.
          </p>
        </div>

        <a
          href="https://www.airbnb.com/help/article/1857"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-700 text-sm underline mb-6 block"
        >
          Verify your Airbnb fee structure →
        </a>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(3)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(5)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderVrboSettingsStep() {
    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Vrbo Fee Structure</h2>
        <p className="text-gray-500 text-sm mb-6">
          Vrbo takes a commission from hosts. The amount depends on your plan.
        </p>

        <div className="space-y-3 mb-6">
          <label className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.vrboFeeModel === 'pay-per-booking' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="radio"
              name="vrboFeeModel"
              checked={setupData.vrboFeeModel === 'pay-per-booking'}
              onChange={() => setSetupData(d => ({ ...d, vrboFeeModel: 'pay-per-booking', vrboCommission: 8 }))}
              className="mt-1 w-5 h-5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-gray-800">Pay-per-booking (8% total)</div>
              <div className="text-sm text-gray-500">Standard plan: 5% commission + 3% payment processing. Most hosts use this.</div>
            </div>
          </label>

          <label className={`flex items-start gap-4 p-4 border-2 rounded-lg cursor-pointer transition-colors ${setupData.vrboFeeModel === 'subscription' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input
              type="radio"
              name="vrboFeeModel"
              checked={setupData.vrboFeeModel === 'subscription'}
              onChange={() => setSetupData(d => ({ ...d, vrboFeeModel: 'subscription', vrboCommission: 3 }))}
              className="mt-1 w-5 h-5 text-blue-600"
            />
            <div>
              <div className="font-semibold text-gray-800">Annual subscription (3% processing only)</div>
              <div className="text-sm text-orange-600 font-medium">LEGACY PLAN: No longer available to new hosts. Only select this if you are certain you are already on this plan from a previous subscription.</div>
            </div>
          </label>
        </div>

        <div className="mb-6">
          <label className="block text-gray-700 font-medium mb-2">Your Vrbo commission rate:</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.1"
              value={setupData.vrboCommission}
              onChange={(e) => setSetupData(d => ({ ...d, vrboCommission: parseFloat(e.target.value) || 0 }))}
              onFocus={handleZeroFieldFocus}
              className="w-24 p-2 border border-gray-300 rounded-lg text-right"
            />
            <span className="text-gray-500">%</span>
          </div>
        </div>

        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-gray-600 text-sm mb-3">
            Vrbo charges the 3% payment processing fee on taxes too. If you want to account for this:
          </p>
          <label className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              checked={setupData.vrboIncludeTax}
              onChange={(e) => setSetupData(d => ({ ...d, vrboIncludeTax: e.target.checked }))}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-gray-700">Include tax in commission calculation</span>
          </label>
          {setupData.vrboIncludeTax && (
            <div className="ml-6">
              <label className="block text-gray-600 text-sm mb-1">Your tax rate:</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={setupData.vrboTaxRate}
                  onChange={(e) => setSetupData(d => ({ ...d, vrboTaxRate: parseFloat(e.target.value) || 0 }))}
                  onFocus={handleZeroFieldFocus}
                  className="w-20 p-2 border border-gray-300 rounded-lg text-right"
                />
                <span className="text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">This will slightly increase your list price to cover the processing fee on the tax portion.</p>
            </div>
          )}
        </div>

        <a
          href="https://help.vrbo.com/articles/How-is-the-booking-fee-calculated"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:text-blue-700 text-sm underline mb-6 block"
        >
          Verify your Vrbo fee structure →
        </a>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(setupData.platforms.airbnb ? 4 : 3)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(setupStep + 1)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderCustomPlatformStep() {
    const addCustomPlatform = () => {
      setSetupData(d => ({
        ...d,
        customPlatforms: [...d.customPlatforms, { name: '', commission: 0 }]
      }))
    }

    const updateCustomPlatform = (index, field, value) => {
      setSetupData(d => {
        const updated = [...d.customPlatforms]
        updated[index] = { ...updated[index], [field]: value }
        return { ...d, customPlatforms: updated }
      })
    }

    const removeCustomPlatform = (index) => {
      setSetupData(d => ({
        ...d,
        customPlatforms: d.customPlatforms.filter((_, i) => i !== index)
      }))
    }

    // Initialize with one empty platform if none exist
    if (setupData.customPlatforms.length === 0) {
      addCustomPlatform()
    }

    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Other Platform Details</h2>
        <p className="text-gray-500 text-sm mb-6">Enter your custom platform information</p>

        <div className="space-y-4 mb-6">
          {setupData.customPlatforms.map((platform, index) => (
            <div key={index} className="p-4 border border-gray-200 rounded-lg">
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-gray-700 text-sm mb-1">Platform name</label>
                  <input
                    type="text"
                    value={platform.name}
                    onChange={(e) => updateCustomPlatform(index, 'name', e.target.value)}
                    placeholder="e.g., Booking.com"
                    className="w-full p-2 border border-gray-300 rounded-lg"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-gray-700 text-sm mb-1">Commission</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="0.1"
                      value={platform.commission}
                      onChange={(e) => updateCustomPlatform(index, 'commission', parseFloat(e.target.value) || 0)}
                      onFocus={handleZeroFieldFocus}
                      className="w-full p-2 border border-gray-300 rounded-lg text-right"
                    />
                    <span className="text-gray-500">%</span>
                  </div>
                </div>
                {setupData.customPlatforms.length > 1 && (
                  <button
                    onClick={() => removeCustomPlatform(index)}
                    className="text-red-600 hover:text-red-700 p-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addCustomPlatform}
          className="text-blue-600 hover:text-blue-700 font-medium mb-6"
        >
          + Add Another Platform
        </button>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(setupStep - 1)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(setupStep + 1)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderNightlyWeightsStep() {
    const weights = setupData.nightlyWeights
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0)
    const isValid = total === 100

    const updateWeight = (day, value) => {
      setSetupData(d => ({
        ...d,
        nightlyWeights: { ...d.nightlyWeights, [day]: parseInt(value) || 0 }
      }))
    }

    const resetDefaults = () => {
      setSetupData(d => ({
        ...d,
        nightlyWeights: { ...DEFAULT_SETTINGS.nightlyWeights }
      }))
    }

    // Calculate example
    const exampleWeekly = 3000
    const exampleFriday = Math.ceil(exampleWeekly * (weights.friday / 100))
    const exampleSaturday = Math.ceil(exampleWeekly * (weights.saturday / 100))
    const exampleTuesday = Math.ceil(exampleWeekly * (weights.tuesday / 100))

    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Nightly Rate Distribution</h2>
        <p className="text-gray-500 text-sm mb-6">
          When platforms require nightly rates, how should we distribute a weekly rate across the 7 nights?
        </p>

        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600">
                <th className="py-2">Day</th>
                <th className="py-2 text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                <tr key={day} className="border-t border-gray-200">
                  <td className="py-2 capitalize">{day}</td>
                  <td className="py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={weights[day]}
                        onChange={(e) => updateWeight(day, e.target.value)}
                        onFocus={handleZeroFieldFocus}
                        className="w-16 p-1 border border-gray-300 rounded text-right"
                      />
                      <span className="text-gray-500">%</span>
                    </div>
                  </td>
                </tr>
              ))}
              <tr className={`border-t-2 font-semibold ${isValid ? 'text-green-600' : 'text-red-600'}`}>
                <td className="py-2">Total</td>
                <td className="py-2 text-right">{total}%</td>
              </tr>
            </tbody>
          </table>
        </div>

        {!isValid && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-red-700 text-sm">
            Weights must total exactly 100%. Currently: {total}%
          </div>
        )}

        <div className="bg-blue-50 rounded-lg p-4 mb-6 text-sm text-blue-800">
          <strong>Example:</strong> A ${exampleWeekly.toLocaleString()} week with these weights →
          Friday = ${exampleFriday}, Saturday = ${exampleSaturday}, Tuesday = ${exampleTuesday}
        </div>

        <button
          onClick={resetDefaults}
          className="text-blue-600 hover:text-blue-700 text-sm mb-6 block"
        >
          Reset to Defaults
        </button>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(setupStep - 1)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(setupStep + 1)}
            disabled={!isValid}
            className={`py-2 px-6 font-semibold rounded-lg transition-colors ${
              isValid
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderDynamicStep6() {
    // Determine what to show based on previous selections
    if (setupData.platforms.airbnb && setupData.platforms.vrbo && setupData.platforms.other) {
      return renderCustomPlatformStep()
    }
    if ((setupData.platforms.airbnb && setupData.platforms.vrbo) ||
        (setupData.platforms.airbnb && setupData.platforms.other) ||
        (setupData.platforms.vrbo && setupData.platforms.other)) {
      return renderNightlyWeightsStep()
    }
    return renderNightlyWeightsStep()
  }

  function renderDynamicStep7() {
    if (setupData.platforms.airbnb && setupData.platforms.vrbo && setupData.platforms.other) {
      return renderNightlyWeightsStep()
    }
    // Jump to seasons (step 9) for simpler platform combinations
    return renderSeasonsSetupStep()
  }

  function renderDynamicStep8() {
    // After all platforms and nightly weights are done, go to seasons
    return renderSeasonsSetupStep()
  }

  function renderSeasonsSetupStep() {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Define Your Seasons</h2>
        <p className="text-gray-500 text-sm mb-4">
          Seasons help group weeks for pricing. You can mark peak seasons as "weekly only" (no nightly rates).
        </p>

        <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
          {setupData.seasons.map((season, idx) => (
            <div key={season.id} className="border border-gray-200 rounded-lg p-3">
              <div className="flex gap-2 items-center mb-2">
                <input
                  type="text"
                  value={season.name}
                  onChange={(e) => {
                    const newSeasons = [...setupData.seasons]
                    newSeasons[idx] = { ...season, name: e.target.value }
                    setSetupData(d => ({ ...d, seasons: newSeasons }))
                  }}
                  className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm"
                  placeholder="Season name"
                />
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={season.weeklyOnly}
                    onChange={(e) => {
                      const newSeasons = [...setupData.seasons]
                      newSeasons[idx] = { ...season, weeklyOnly: e.target.checked }
                      setSetupData(d => ({ ...d, seasons: newSeasons }))
                    }}
                    className="w-3 h-3"
                  />
                  Weekly only
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={season.closedToGuests || false}
                    onChange={(e) => {
                      const newSeasons = [...setupData.seasons]
                      newSeasons[idx] = { ...season, closedToGuests: e.target.checked }
                      setSetupData(d => ({ ...d, seasons: newSeasons }))
                    }}
                    className="w-3 h-3"
                  />
                  Closed to Guests
                </label>
                {setupData.seasons.length > 1 && (
                  <button
                    onClick={() => {
                      const newSeasons = setupData.seasons.filter((_, i) => i !== idx)
                      setSetupData(d => ({ ...d, seasons: newSeasons }))
                    }}
                    className="text-red-500 hover:text-red-700 text-sm px-2"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="flex gap-2 items-center text-xs text-gray-600">
                <select
                  value={season.startMonth}
                  onChange={(e) => {
                    const newSeasons = [...setupData.seasons]
                    newSeasons[idx] = { ...season, startMonth: parseInt(e.target.value) }
                    setSetupData(d => ({ ...d, seasons: newSeasons }))
                  }}
                  className="px-1 py-0.5 border border-gray-300 rounded text-xs"
                >
                  {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <input
                  type="number"
                  value={season.startDay}
                  min="1"
                  max="31"
                  onChange={(e) => {
                    const newSeasons = [...setupData.seasons]
                    newSeasons[idx] = { ...season, startDay: parseInt(e.target.value) || 1 }
                    setSetupData(d => ({ ...d, seasons: newSeasons }))
                  }}
                  className="w-12 px-1 py-0.5 border border-gray-300 rounded text-xs"
                />
                <span>to</span>
                <select
                  value={season.endMonth}
                  onChange={(e) => {
                    const newEndMonth = parseInt(e.target.value)
                    const newSeasons = [...setupData.seasons]
                    newSeasons[idx] = { ...season, endMonth: newEndMonth }
                    // Auto-update next season's start date
                    if (idx < newSeasons.length - 1) {
                      const endDate = new Date(2000, newEndMonth - 1, season.endDay)
                      endDate.setDate(endDate.getDate() + 1)
                      newSeasons[idx + 1] = {
                        ...newSeasons[idx + 1],
                        startMonth: endDate.getMonth() + 1,
                        startDay: endDate.getDate()
                      }
                    }
                    setSetupData(d => ({ ...d, seasons: newSeasons }))
                  }}
                  className="px-1 py-0.5 border border-gray-300 rounded text-xs"
                >
                  {monthNames.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
                <input
                  type="number"
                  value={season.endDay}
                  min="1"
                  max="31"
                  onChange={(e) => {
                    const newEndDay = parseInt(e.target.value) || 1
                    const newSeasons = [...setupData.seasons]
                    newSeasons[idx] = { ...season, endDay: newEndDay }
                    // Auto-update next season's start date
                    if (idx < newSeasons.length - 1) {
                      const endDate = new Date(2000, season.endMonth - 1, newEndDay)
                      endDate.setDate(endDate.getDate() + 1)
                      newSeasons[idx + 1] = {
                        ...newSeasons[idx + 1],
                        startMonth: endDate.getMonth() + 1,
                        startDay: endDate.getDate()
                      }
                    }
                    setSetupData(d => ({ ...d, seasons: newSeasons }))
                  }}
                  className="w-12 px-1 py-0.5 border border-gray-300 rounded text-xs"
                />
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => {
            const lastSeason = setupData.seasons[setupData.seasons.length - 1]
            const newId = Math.max(...setupData.seasons.map(s => s.id)) + 1
            const newSeason = {
              id: newId,
              name: 'New Season',
              startMonth: lastSeason ? lastSeason.endMonth : 1,
              startDay: lastSeason ? lastSeason.endDay + 1 : 1,
              endMonth: 12,
              endDay: 31,
              percentage: 0,
              weeklyOnly: false,
              closedToGuests: false
            }
            setSetupData(d => ({ ...d, seasons: [...d.seasons, newSeason] }))
          }}
          className="text-blue-600 hover:text-blue-700 text-sm mb-6"
        >
          + Add Season
        </button>

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(s => s - 1)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(10)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderAnchorsSetupStep() {
    const sourceYear = new Date().getFullYear()
    const targetYear = sourceYear + 1

    return (
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Holiday & Custom Anchors</h2>
        <p className="text-gray-500 text-sm mb-4">
          These dates ensure pricing aligns year-to-year. Holidays are pre-selected. Add custom dates for local events.
        </p>

        <div className="bg-blue-50 rounded-lg p-3 mb-4 text-sm text-blue-800">
          <strong>What are anchors?</strong> When planning next year's prices, anchors ensure that holiday weeks (like July 4th) stay aligned correctly, even when the day of the week shifts.
        </div>

        <div className="space-y-2 mb-4">
          {(setupData.anchors || []).map(anchor => {
            const sourceDate = new Date(anchor.sourceDate)
            const targetDate = new Date(anchor.targetDate)
            return (
              <label
                key={anchor.id}
                className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  anchor.enabled ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                } ${anchor.type === 'custom' ? 'bg-purple-50 border-purple-300' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={anchor.enabled}
                  onChange={(e) => {
                    setSetupData(d => ({
                      ...d,
                      anchors: d.anchors.map(a =>
                        a.id === anchor.id ? { ...a, enabled: e.target.checked } : a
                      )
                    }))
                  }}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-800">
                    {anchor.name}
                    {anchor.type === 'custom' && <span className="ml-1 text-xs text-purple-600">(custom)</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {sourceDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} → {targetDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                {anchor.type === 'custom' && (
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      setSetupData(d => ({
                        ...d,
                        anchors: d.anchors.filter(a => a.id !== anchor.id)
                      }))
                    }}
                    className="text-red-500 hover:text-red-700 px-3 py-1 rounded hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </label>
            )
          })}
        </div>

        {isAddingAnchor ? (
          <div className="flex items-end gap-2 p-3 bg-blue-50 rounded border border-blue-200 mb-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">Name</label>
              <input
                type="text"
                value={newAnchorLabel}
                onChange={(e) => setNewAnchorLabel(e.target.value)}
                placeholder="e.g., April School Break"
                className="w-full p-2 border border-gray-300 rounded"
                autoFocus
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">2026 Date</label>
              <input
                type="date"
                value={newAnchorSourceDate}
                onChange={(e) => setNewAnchorSourceDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-600 mb-1">2027 Date</label>
              <input
                type="date"
                value={newAnchorTargetDate}
                onChange={(e) => setNewAnchorTargetDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded"
              />
            </div>
            <button
              onClick={() => {
                if (newAnchorLabel && newAnchorSourceDate && newAnchorTargetDate) {
                  const newAnchor = {
                    id: `custom_${Date.now()}`,
                    name: newAnchorLabel,
                    type: 'custom',
                    enabled: true,
                    sourceDate: newAnchorSourceDate,
                    targetDate: newAnchorTargetDate
                  }
                  setSetupData(d => ({
                    ...d,
                    anchors: [...(d.anchors || []), newAnchor]
                  }))
                  setNewAnchorLabel('')
                  setNewAnchorSourceDate('')
                  setNewAnchorTargetDate('')
                  setIsAddingAnchor(false)
                }
              }}
              disabled={!newAnchorLabel || !newAnchorSourceDate || !newAnchorTargetDate}
              className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex-shrink-0"
            >
              Save
            </button>
            <button
              onClick={() => {
                setNewAnchorLabel('')
                setNewAnchorSourceDate('')
                setNewAnchorTargetDate('')
                setIsAddingAnchor(false)
              }}
              className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex-shrink-0"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsAddingAnchor(true)}
            className="py-2 px-4 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 mb-6"
          >
            + Add Custom Anchor
          </button>
        )}

        <div className="flex justify-between">
          <button
            onClick={() => setSetupStep(9)}
            className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => setSetupStep(11)}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    )
  }

  function renderSetupCompleteStep() {
    return (
      <div className="text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-green-600 text-3xl">✓</span>
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">You're all set!</h2>
        <p className="text-gray-500 mb-6">
          These settings are saved and you can change them anytime in Settings.
        </p>

        <button
          onClick={completeSetup}
          className="py-3 px-8 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
        >
          {setupData.pricingSource === 'wnav' ? 'Import from WNAV' : 'Enter Prices Manually'}
        </button>
      </div>
    )
  }

  async function completeSetup() {
    const newSettings = {
      ...DEFAULT_SETTINGS,
      setupComplete: true,
      pricingSource: setupData.pricingSource,
      platforms: {
        wnav: { enabled: setupData.platforms.wnav, commission: 0 },
        airbnb: {
          enabled: setupData.platforms.airbnb,
          commission: setupData.airbnbCommission / 100,
          feeModel: setupData.airbnbFeeModel,
          lastVerified: setupData.platforms.airbnb ? new Date().toISOString() : null
        },
        vrbo: {
          enabled: setupData.platforms.vrbo,
          commission: setupData.vrboCommission / 100,
          feeModel: setupData.vrboFeeModel,
          lastVerified: setupData.platforms.vrbo ? new Date().toISOString() : null
        },
        custom: setupData.customPlatforms.filter(p => p.name).map(p => ({
          name: p.name,
          commission: p.commission / 100,
          enabled: true
        }))
      },
      nightlyWeights: setupData.nightlyWeights,
      seasons: setupData.seasons,
      anchors: setupData.anchors
    }

    const saved = await saveSettings(newSettings)
    if (saved) {
      setAppState('main')
    }
  }

  // ============ WNAV FUNCTIONS ============

  async function checkLoginStatus() {
    try {
      const response = await fetch('/api/auth/status')
      const data = await response.json()
      setIsLoggedIn(data.loggedIn)
      setHasValidSession(data.loggedIn) // Only true if actually logged in
    } catch (error) {
      console.error('Failed to check login status:', error)
      setHasValidSession(false)
    }
  }

  // Unified WNAV import - handles login + scrape in one operation
  async function handleWnavImport() {
    setLoginState('loading')
    setLoginError('')
    setScrapeState('loading')
    setScrapeError('')
    setMonths([])
    setListingId(null)
    setHasChanges(false)
    setConflictResolutions({})
    setMergeStats(null)
    setShowMissingWeeksList(false)
    setYearPlanningApplied(false)
    setShowYearPlanning(true)
    isInitialLoad.current = true

    try {
      // This endpoint handles both login and scraping
      const response = await fetch('/api/wnav/import', { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        setLoginState('success')
        setScrapeState('success')
        setIsLoggedIn(true)
        setHasValidSession(true)
        setListingId(data.listingId)
        setPropertyName(data.propertyName || '')
        setPageTitle(data.pageTitle || '')
        setMonths(data.months || [])
        setMergeStats(data.mergeStats || null)
      } else {
        setLoginState('error')
        setScrapeState('error')
        setLoginError(data.error || 'Import failed')
        setScrapeError(data.error || 'Import failed')
        setHasValidSession(false)
      }
    } catch (error) {
      setLoginState('error')
      setScrapeState('error')
      setLoginError('Could not connect to server')
      setScrapeError('Could not connect to server')
      setHasValidSession(false)
    }
  }

  // Login and auto-import - captures session then automatically imports data
  async function handleLogin() {
    setLoginState('loading')
    setLoginError('')

    try {
      const response = await fetch('/api/auth/capture', { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        setLoginState('success')
        setIsLoggedIn(true)
        setHasValidSession(true)
        // If server detected property info, save it
        if (data.listingId) setListingId(data.listingId)
        if (data.propertyName) setPropertyName(data.propertyName)

        // Auto-start import after successful login
        handleScrape()
      } else {
        setLoginState('error')
        setLoginError(data.error || 'Login failed')
        setHasValidSession(false)
      }
    } catch (error) {
      setLoginState('error')
      setLoginError('Could not connect to server')
      setHasValidSession(false)
    }
  }

  // Scrape calendar after login
  async function handleScrape() {
    setScrapeState('loading')
    setScrapeError('')

    // Clear all previous data before re-importing
    setMonths([])
    setOriginalSourceMonths([])
    setCustomProposedPrices({})
    setCustomPlatformPrices({})
    setConflictResolutions({})
    setMergeStats(null)
    setYearPlanningApplied(false)
    setManualPrices({})

    try {
      // Use unified import which handles everything
      const response = await fetch('/api/wnav/import', { method: 'POST' })
      const data = await response.json()

      if (data.success) {
        setScrapeState('success')
        setIsLoggedIn(true)
        setHasValidSession(true)
        setListingId(data.listingId)
        setPropertyName(data.propertyName || '')
        setMonths(data.months || [])
        setMergeStats(data.mergeStats || null)
      } else {
        setScrapeState('error')
        setScrapeError(data.error || 'Import failed')
      }
    } catch (error) {
      setScrapeState('error')
      setScrapeError('Could not connect to server')
    }
  }

  // ============ CALENDAR FUNCTIONS ============

  function toggleMonth(monthIndex) {
    setExpandedMonths(prev => ({
      ...prev,
      [monthIndex]: !prev[monthIndex]
    }))
  }

  function updateWeekPrice(monthIndex, weekIndex, newPrice) {
    const updateMonthsArray = (monthsArray) => {
      const updated = [...monthsArray]
      if (updated[monthIndex]) {
        updated[monthIndex] = {
          ...updated[monthIndex],
          weeks: updated[monthIndex].weeks.map((week, idx) =>
            idx === weekIndex ? {
              ...week,
              price: newPrice,
              // Mark as no longer missing if price is set
              needsManualEntry: !newPrice || newPrice === '' || newPrice === '$0' ? true : false,
              source: week.source === 'missing' && newPrice ? 'manual' : week.source
            } : week
          )
        }
      }
      return updated
    }

    setMonths(prev => updateMonthsArray(prev))

    // Also update originalSourceMonths if it has data (for Planning tab consistency)
    setOriginalSourceMonths(prev => prev.length > 0 ? updateMonthsArray(prev) : prev)

    setHasChanges(true)
  }

  function calculateMonthTotal(month) {
    return month.weeks.reduce((sum, week) => {
      const price = parseInt(String(week.price || '').replace(/[$,]/g, '')) || 0
      return sum + price
    }, 0)
  }

  function formatWeekDates(week) {
    if (!week?.startDate || !week?.endDate) return 'Unknown dates'
    const startDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
    const endDate = new Date(week.endDate.year, week.endDate.month, week.endDate.day)
    const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return `${formatDate(startDate)} - ${formatDate(endDate)}`
  }

  async function handleSave() {
    if (!listingId) return
    setSaveState('loading')

    try {
      const response = await fetch('/api/calendar/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, months })
      })
      const data = await response.json()

      if (data.success) {
        setSaveState('success')
        setHasChanges(false)
        setTimeout(() => setSaveState('idle'), 2000)
      } else {
        setSaveState('error')
      }
    } catch (error) {
      setSaveState('error')
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'booked':
        return <span className="px-2 py-1 bg-red-100 text-red-700 rounded text-sm">Booked</span>
      case 'available':
        return <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-sm">Available</span>
      case 'partial':
        return <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-sm">Partial</span>
      case 'unknown':
        return <span className="px-2 py-1 bg-yellow-200 text-yellow-800 rounded text-sm">No Data</span>
      default:
        return <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-sm">Unknown</span>
    }
  }

  // ============ YEAR PLANNING FUNCTIONS ============

  // Auto-detect source year
  useEffect(() => {
    if (yearPlanningApplied) return
    if (months.length > 0) {
      const allWeeks = months.flatMap(month => month.weeks)
      if (allWeeks.length > 0) {
        const firstWeek = allWeeks[0]
        const detectedYear = firstWeek.startDate?.year
        if (detectedYear && detectedYear !== sourceYear) {
          setSourceYear(detectedYear)
          setTargetYear(detectedYear + 1)
        }
      }
    }
  }, [months, yearPlanningApplied])

  // Set default expanded months
  useEffect(() => {
    if (months.length > 0 && isInitialLoad.current) {
      isInitialLoad.current = false
      const now = new Date()
      const currentMonth = now.toLocaleString('en-US', { month: 'long' })
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1).toLocaleString('en-US', { month: 'long' })

      const newExpanded = {}
      months.forEach((m, idx) => {
        if (m.month === currentMonth || m.month === nextMonth) {
          newExpanded[idx] = true
        }
      })
      setExpandedMonths(newExpanded)
    }
  }, [months])

  // ============ TEST MODE FUNCTIONS ============

  function generateTestData() {
    const currentYear = new Date().getFullYear()
    const testMonths = []

    // Sample pricing tiers (realistic Cape Cod vacation rental prices)
    const seasonalPricing = {
      'January': 1800,
      'February': 1800,
      'March': 2000,
      'April': 2200,
      'May': 2800,
      'June': 4200,
      'July': 5500,
      'August': 5500,
      'September': 3500,
      'October': 2800,
      'November': 2200,
      'December': 2000
    }

    // Generate weeks for a full year starting from first Saturday
    let startDate = new Date(currentYear, 0, 1) // Jan 1
    const dayOfWeek = startDate.getDay()
    const daysToSaturday = (6 - dayOfWeek + 7) % 7 || 7
    startDate.setDate(startDate.getDate() + daysToSaturday - 7) // Go back to previous Saturday if needed

    // Make sure we start in the current year
    if (startDate.getFullYear() < currentYear) {
      startDate.setDate(startDate.getDate() + 7)
    }

    const monthMap = new Map()

    while (startDate.getFullYear() === currentYear) {
      const weekStart = new Date(startDate)
      const weekEnd = new Date(startDate)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const monthName = weekStart.toLocaleString('en-US', { month: 'long' })
      const monthKey = `${monthName}-${currentYear}`

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, { month: monthName, year: currentYear, weeks: [] })
      }

      // Add some variation to prices (+/- 10%)
      const basePrice = seasonalPricing[monthName]
      const variation = Math.floor((Math.random() - 0.5) * 0.2 * basePrice)
      const price = Math.round((basePrice + variation) / 10) * 10

      const weekKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`

      monthMap.get(monthKey).weeks.push({
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
        },
        price: `$${price.toLocaleString()}`,
        status: Math.random() > 0.9 ? 'booked' : 'available'
      })

      startDate.setDate(startDate.getDate() + 7)
    }

    // Convert to array and sort
    const sortedMonths = Array.from(monthMap.values()).sort((a, b) => {
      const monthOrder = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December']
      return monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month)
    })

    // Sort weeks within each month
    sortedMonths.forEach(month => {
      month.weeks.sort((a, b) => {
        const dateA = new Date(a.startDate.year, a.startDate.month, a.startDate.day)
        const dateB = new Date(b.startDate.year, b.startDate.month, b.startDate.day)
        return dateA - dateB
      })
    })

    return sortedMonths
  }

  function loadTestData() {
    const testData = generateTestData()
    setOriginalTestData(testData)
    setMonths(testData)
    setIsTestMode(true)
    setScrapeState('success')
    setIsLoggedIn(true) // Fake login for testing
    setHasValidSession(true) // Mark as having valid session for UI
    setMergeStats(null)

    // Set source/target years
    const year = testData[0]?.year || new Date().getFullYear()
    setSourceYear(year)
    setTargetYear(year + 1)
  }

  // Note: parsePrice, formatPrice, calculateListPrice, calculateNightlyRates,
  // and calculateAdjustedPrice are now imported from ./utils/calculations.js

  // Navigate to planning tab with validation for missing prices AND conflicts
  function handleNavigateToPlanning() {
    // Check for weeks with missing prices (excluding closed weeks)
    const allWeeks = months.flatMap(m => m.weeks)
    const weeksWithMissingPrices = allWeeks.filter(w => {
      if (parsePrice(w.price) !== 0) return false
      const weekDate = new Date(w.startDate.year, w.startDate.month, w.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    if (weeksWithMissingPrices.length > 0) {
      // Show warning modal with missing weeks
      const missingWeekLabels = weeksWithMissingPrices.map(w => {
        if (w.startDate && w.endDate) {
          const start = new Date(w.startDate.year, w.startDate.month, w.startDate.day)
          const end = new Date(w.endDate.year, w.endDate.month, w.endDate.day)
          return `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
        }
        return w.weekKey || 'Unknown week'
      })
      setMissingWeeksForModal(missingWeekLabels)
      setMissingDataModalContext('planning') // Set context for modal
      setShowMissingDataModal(true)
      return
    }

    // Check for week mapping conflicts
    const sourceWeeks = allWeeks.filter(week => week.startDate?.year === sourceYear)
    const weekStart = settings?.weekStartDay ?? 6
    const mappings = mapWeeksByHolidays(sourceWeeks, sourceYear, targetYear, settings?.anchors || [], weekStart)
    const conflicts = detectConflicts(mappings, targetYear, weekStart)
    const conflictsWithOptions = conflicts.filter(c => c.options && c.options.length > 0)
    const unresolvedConflicts = conflictsWithOptions.filter((conflict, idx) => {
      const key = `${conflict.type}-${idx}`
      return !conflictResolutions[key]
    })

    if (unresolvedConflicts.length > 0) {
      // Navigate to planning tab to show and resolve conflicts
      setActiveTab('planning')
      return
    }

    // No issues, navigate directly
    setActiveTab('planning')
  }

  function getSeasonForDate(date) {
    if (!settings?.seasons || !date) return null
    const month = date.getMonth() + 1
    const day = date.getDate()

    for (const season of settings.seasons) {
      const startDate = new Date(2000, season.startMonth - 1, season.startDay)
      const endDate = new Date(2000, season.endMonth - 1, season.endDay)
      const checkDate = new Date(2000, month - 1, day)

      if (checkDate >= startDate && checkDate <= endDate) {
        return season
      }
    }
    return null
  }

  function isWeekClosedToGuests(weekStartDate) {
    const season = getSeasonForDate(weekStartDate)
    return season?.closedToGuests === true
  }

  // ============ PLATFORM PRICING CALCULATOR ============
  // Note: calculateAdjustedPrice, calculateListPrice, and calculateNightlyRates
  // are now imported from ./utils/calculations.js

  // ============ RENDER MAIN APP ============

  function renderMainApp() {
    return (
      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-800">STR Pricing Updater</h1>
            <button
              onClick={() => setActiveTab('settings')}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Settings"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>

          {/* Tab Navigation */}
          <div className="max-w-7xl mx-auto px-4 border-t border-gray-200">
            <nav className="flex space-x-8">
              {[
                { id: 'import', label: settings?.pricingSource === 'manual' ? 'Enter Prices' : 'Import & Edit' },
                { id: 'planning', label: 'Plan Next Year' },
                { id: 'platforms', label: 'Platform Pricing' },
                { id: 'guide', label: 'Entry Guide' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 py-8">
          {/* Show loading overlay during import for data-dependent tabs */}
          {scrapeState === 'loading' && activeTab !== 'import' && activeTab !== 'settings' && (
            <div className="bg-white p-8 rounded-lg shadow text-center">
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
              <p className="text-gray-500">Importing data...</p>
            </div>
          )}
          {(scrapeState !== 'loading' || activeTab === 'import' || activeTab === 'settings') && (
            <>
              {activeTab === 'import' && renderImportTab()}
              {activeTab === 'planning' && renderPlanningTab()}
              {activeTab === 'platforms' && renderPlatformsTab()}
              {activeTab === 'guide' && renderGuideTab()}
              {activeTab === 'settings' && renderSettingsTab()}
            </>
          )}
        </main>

        {/* Missing Data Modal */}
        {showMissingDataModal && renderMissingDataModal()}
      </div>
    )
  }

  function renderImportTab() {
    if (settings?.pricingSource === 'manual') {
      return renderManualEntryInterface()
    }

    return (
      <div className="space-y-6">
        {/* Test Mode Banner */}
        {isTestMode && (
          <div className="p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-yellow-800 font-medium">Test Mode Active - Using sample data</span>
              <button
                onClick={() => {
                  setIsTestMode(false)
                  setMonths([])
                  setIsLoggedIn(false)
                  setHasValidSession(false)
                  setScrapeState('idle')
                }}
                className="text-sm text-yellow-700 underline hover:no-underline"
              >
                Exit Test Mode
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Login Card */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Step 1: Connect to WNAV</h2>

          {isTestMode ? (
            <div className="text-yellow-700">Using test data (no WNAV connection)</div>
          ) : hasValidSession && isLoggedIn ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-600 font-semibold">
                <span>✓</span>
                <span>Connected to WNAV</span>
              </div>
              <button
                onClick={() => {
                  setIsLoggedIn(false)
                  setHasValidSession(false)
                  setLoginState('idle')
                }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <p className="text-gray-600 mb-4">
                Click below to open WNAV in a browser window. Log in with your owner account.
              </p>
              <button
                onClick={handleLogin}
                disabled={loginState === 'loading'}
                className={`py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
                  loginState === 'loading'
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                }`}
              >
                {loginState === 'loading' ? 'Opening browser... please log in' : 'Log in to WNAV'}
              </button>

              {loginState === 'error' && (
                <p className="mt-3 text-red-600">Error: {loginError}</p>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Import Card - only show after login */}
        {(hasValidSession || isTestMode) && (
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Step 2: Import Calendar</h2>

            {scrapeState === 'loading' ? (
              <div className="py-12 text-center">
                <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-6"></div>
                <p className="text-xl font-semibold text-gray-700 mb-2">Importing Data from Pricing Calendar</p>
                <p className="text-gray-500">This may take up to a minute...</p>
              </div>
            ) : scrapeState === 'success' && months.length > 0 ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-green-700 font-semibold mb-2">
                  <span className="text-xl">✓</span>
                  <span>Successfully imported calendar{propertyName ? ` for ${propertyName}` : ''}</span>
                </div>
                <p className="text-green-600 text-sm">
                  {mergeStats?.weeksFromScrape || months.reduce((sum, m) => sum + m.weeks.length, 0)} weeks imported
                </p>
              </div>
            ) : (
              <div>
                <p className="text-gray-600 mb-4">
                  Import your calendar and pricing data from WNAV.
                </p>
                <button
                  onClick={handleScrape}
                  disabled={scrapeState === 'loading'}
                  className={`py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
                    scrapeState === 'loading'
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 cursor-pointer'
                  }`}
                >
                  {scrapeState === 'loading' ? 'Importing...' : 'Import Calendar'}
                </button>

                {scrapeState === 'error' && (
                  <p className="mt-3 text-red-600">Error: {scrapeError}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Re-import option when we have data */}
        {scrapeState === 'success' && months.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="flex gap-4 items-center flex-wrap">
              <button
                onClick={handleScrape}
                disabled={scrapeState === 'loading'}
                className="py-2 px-4 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Re-import Calendar
              </button>

              {hasChanges && (
                <button
                  onClick={handleSave}
                  disabled={saveState === 'loading'}
                  className={`py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
                    saveState === 'loading'
                      ? 'bg-gray-400 cursor-not-allowed'
                      : saveState === 'success'
                      ? 'bg-green-600'
                      : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                  }`}
                >
                  {saveState === 'loading' ? 'Saving...' : saveState === 'success' ? 'Saved ✓' : 'Save Changes'}
                </button>
              )}
            </div>

            {scrapeState !== 'success' && !isTestMode && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Tip:</strong> WNAV removes pricing for past weeks. For best results, import your calendar at the start of the year when all weeks are visible.
                </p>
              </div>
            )}

            {scrapeState === 'error' && (
              <p className="mt-4 text-red-600">Error: {scrapeError}</p>
            )}

            {/* Partial Data Warning */}
            {mergeStats && mergeStats.missingWeeks > 0 && (
              <div className="mt-4 p-4 bg-yellow-50 border border-yellow-300 rounded-lg">
                <h4 className="font-medium text-yellow-800 mb-2">Partial Data Warning</h4>
                <p className="text-sm text-yellow-700 mb-2">
                  Found pricing for <strong>{mergeStats.weeksFromScrape}</strong> weeks from WNAV.
                  {mergeStats.weeksFromExisting > 0 && (
                    <> Preserved <strong>{mergeStats.weeksFromExisting}</strong> weeks from previous imports.</>
                  )}
                </p>
                <p className="text-sm text-yellow-700 mb-2">
                  <strong>{mergeStats.missingWeeks}</strong> week{mergeStats.missingWeeks > 1 ? 's are' : ' is'} missing data and highlighted for manual entry.
                </p>
                <button
                  onClick={() => setShowMissingWeeksList(!showMissingWeeksList)}
                  className="text-sm text-yellow-800 underline hover:no-underline"
                >
                  {showMissingWeeksList ? 'Hide' : 'Show'} missing weeks
                </button>
                {showMissingWeeksList && mergeStats.missingWeekKeys && (
                  <ul className="mt-2 text-sm text-yellow-700 list-disc list-inside max-h-32 overflow-y-auto">
                    {mergeStats.missingWeekKeys.map(weekKey => {
                      const [year, month, day] = weekKey.split('-').map(Number)
                      const startDate = new Date(year, month - 1, day)
                      const endDate = new Date(startDate)
                      endDate.setDate(endDate.getDate() + 7)
                      const formatDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      return (
                        <li key={weekKey}>{formatDate(startDate)} - {formatDate(endDate)}: No data</li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* Success Message and Next Button */}
        {months.length > 0 && scrapeState === 'success' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 text-green-700 font-semibold mb-1">
                  <span className="text-xl">✓</span>
                  <span>Calendar data imported successfully</span>
                </div>
                <p className="text-sm text-green-600">
                  {months.reduce((sum, m) => sum + m.weeks.length, 0)} weeks imported for {sourceYear || new Date().getFullYear()}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setExpandedMonths({})
                    months.forEach((_, idx) => setExpandedMonths(prev => ({ ...prev, [idx]: true })))
                  }}
                  className="py-2 px-4 border border-green-300 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                >
                  View Imported Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Calendar Results */}
        {months.length > 0 && renderCalendarGrid()}

        {/* Bottom Navigation */}
        {months.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={handleNavigateToPlanning}
              className="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              NEXT: Plan Next Year →
            </button>
          </div>
        )}

        {/* Testing Tools - Collapsible Section */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <button
            onClick={() => setShowTestingTools(!showTestingTools)}
            className="w-full p-4 text-left flex items-center justify-between bg-gray-50 hover:bg-gray-100 border-b border-gray-200"
          >
            <span className="font-medium text-gray-600">Testing Tools</span>
            <span className="text-gray-400">{showTestingTools ? '▼' : '▶'}</span>
          </button>

          {showTestingTools && (
            <div className="p-4">
              <p className="text-sm text-gray-500 mb-4">
                Use these buttons to test different data states without connecting to WNAV.
              </p>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => {
                    loadTestData()
                    setScrapeState('success')
                  }}
                  className="py-2 px-4 bg-green-100 text-green-700 border border-green-300 rounded-lg hover:bg-green-200"
                >
                  Load Complete Test Data
                </button>

                <button
                  onClick={() => {
                    // Load test data with some missing prices
                    const testData = generateTestData()
                    // Remove prices for Jan-May
                    testData.forEach(month => {
                      const monthIdx = MONTH_NAMES_FULL.indexOf(month.month)
                      if (monthIdx >= 0 && monthIdx < 5) { // Jan-May
                        month.weeks.forEach(week => {
                          week.price = ''
                        })
                      }
                    })
                    setOriginalTestData(testData)
                    setMonths(testData)
                    setIsTestMode(true)
                    setScrapeState('success')
                    setHasValidSession(true)
                    setIsLoggedIn(true)
                    const year = testData[0]?.year || new Date().getFullYear()
                    setSourceYear(year)
                    setTargetYear(year + 1)
                    setMergeStats({
                      weeksFromScrape: testData.filter(m => MONTH_NAMES_FULL.indexOf(m.month) >= 5).reduce((sum, m) => sum + m.weeks.length, 0),
                      weeksFromExisting: 0,
                      missingWeeks: testData.filter(m => MONTH_NAMES_FULL.indexOf(m.month) < 5).reduce((sum, m) => sum + m.weeks.length, 0),
                      missingWeekKeys: testData.flatMap(m =>
                        MONTH_NAMES_FULL.indexOf(m.month) < 5 ? m.weeks.map(w => w.weekKey) : []
                      )
                    })
                  }}
                  className="py-2 px-4 bg-yellow-100 text-yellow-700 border border-yellow-300 rounded-lg hover:bg-yellow-200"
                >
                  Load Partial Test Data (Jan-May missing)
                </button>

                <button
                  onClick={() => {
                    setIsTestMode(false)
                    setMonths([])
                    setIsLoggedIn(false)
                    setHasValidSession(false)
                    setScrapeState('idle')
                    setMergeStats(null)
                    setOriginalTestData(null)
                  }}
                  className="py-2 px-4 bg-gray-100 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-200"
                >
                  Clear Test Data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderManualEntryInterface() {
    const currentYear = new Date().getFullYear()

    // Determine week start day
    const effectiveWeekStart = useStandardCalendarWeeks ? 0 : (settings?.weekStartDay ?? 6)

    // Memoize generated weeks to prevent recreation on every render
    const generatedWeeks = useMemo(() => {
      return generateWeeksForYear(manualYear, effectiveWeekStart)
    }, [manualYear, effectiveWeekStart])

    // Memoize weeksWithPrices structure (but not the prices themselves)
    const weeksWithPrices = useMemo(() => {
      return generatedWeeks.map(week => ({
        weekKey: week.key,
        startDate: {
          year: week.start.getFullYear(),
          month: week.start.getMonth(),
          day: week.start.getDate()
        },
        endDate: {
          year: week.end.getFullYear(),
          month: week.end.getMonth(),
          day: week.end.getDate()
        }
      }))
    }, [generatedWeeks])

    // Memoize month groups structure
    const monthGroups = useMemo(() => {
      const groups = {}
      weeksWithPrices.forEach(week => {
        const monthName = MONTH_NAMES_FULL[week.startDate.month]
        if (!groups[monthName]) {
          groups[monthName] = []
        }
        groups[monthName].push(week)
      })
      return groups
    }, [weeksWithPrices])

    // Function to apply manual data to app state
    const applyManualData = () => {
      const monthMap = new Map()

      weeksWithPrices.forEach(week => {
        const monthName = MONTH_NAMES_FULL[week.startDate.month]
        const monthKey = `${monthName}-${week.startDate.year}`
        const price = manualPrices[week.weekKey] || ''

        if (!monthMap.has(monthKey)) {
          monthMap.set(monthKey, { month: monthName, year: week.startDate.year, weeks: [] })
        }

        monthMap.get(monthKey).weeks.push({
          weekKey: week.weekKey,
          startDate: week.startDate,
          endDate: week.endDate,
          price: price ? `$${parseInt(price).toLocaleString()}` : '',
          status: 'available'
        })
      })

      const sortedMonths = Array.from(monthMap.values()).sort((a, b) => {
        return MONTH_NAMES_FULL.indexOf(a.month) - MONTH_NAMES_FULL.indexOf(b.month)
      })

      setMonths(sortedMonths)
      setSourceYear(manualYear)
      setTargetYear(manualYear + 1)
      setHasChanges(true)
    }

    // Count weeks with prices entered
    const weeksWithPricesCount = Object.keys(manualPrices).filter(k => k.startsWith(`${manualYear}-`) && manualPrices[k]).length

    return (
      <div className="space-y-6">
        {/* Configuration */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Enter Your Target NET Prices</h2>
          <p className="text-gray-500 text-sm mb-4">
            Enter what you want to take home after commissions for each week. These are your target NET prices.
          </p>

          <div className="flex flex-wrap gap-6 items-end mb-6">
            {/* Year Selection */}
            <div>
              <label className="block text-gray-600 mb-2">Year:</label>
              <select
                value={manualYear}
                onChange={(e) => setManualYear(parseInt(e.target.value))}
                className="p-2 border border-gray-300 rounded-lg"
              >
                {[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Week Start Day */}
            <div>
              <label className="block text-gray-600 mb-2">Week Start Day:</label>
              <select
                value={useStandardCalendarWeeks ? 'standard' : (settings?.weekStartDay ?? 6)}
                onChange={(e) => {
                  if (e.target.value === 'standard') {
                    setUseStandardCalendarWeeks(true)
                  } else {
                    setUseStandardCalendarWeeks(false)
                    saveSettings({ ...settings, weekStartDay: parseInt(e.target.value) })
                  }
                }}
                className="p-2 border border-gray-300 rounded-lg"
                disabled={useStandardCalendarWeeks}
              >
                {DAY_NAMES.map((name, idx) => (
                  <option key={idx} value={idx}>{name}</option>
                ))}
              </select>
            </div>

            {/* Standard Calendar Weeks Checkbox */}
            <label className="flex items-center gap-2 text-sm text-gray-600 pb-2">
              <input
                type="checkbox"
                checked={useStandardCalendarWeeks}
                onChange={(e) => setUseStandardCalendarWeeks(e.target.checked)}
                className="w-4 h-4"
              />
              Use standard calendar weeks (Sunday start)
            </label>
          </div>

          {/* Progress indicator */}
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>{weeksWithPricesCount}</strong> of <strong>{generatedWeeks.length}</strong> weeks have prices entered for {manualYear}
            </p>
          </div>
        </div>

        {/* Week Entry Grid */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="font-semibold text-gray-700 mb-4">Weekly Prices for {manualYear}</h3>

          <div className="space-y-6">
            {Object.entries(monthGroups).map(([monthName, weeks]) => (
              <div key={monthName} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 font-medium text-gray-700">
                  {monthName} ({weeks.filter(w => manualPrices[w.weekKey]).length}/{weeks.length} weeks)
                </div>
                <div className="p-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pb-2">Week</th>
                        <th className="pb-2 text-right">Target NET Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {weeks.map(week => {
                        const startStr = `${MONTH_NAMES[week.startDate.month]} ${week.startDate.day}`
                        const endStr = `${MONTH_NAMES[week.endDate.month]} ${week.endDate.day}`
                        return (
                          <tr key={week.weekKey} className="border-t border-gray-100">
                            <td className="py-2 text-gray-700">
                              {startStr} - {endStr}
                            </td>
                            <td className="py-2">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-gray-400">$</span>
                                <input
                                  type="number"
                                  value={manualPrices[week.weekKey] || ''}
                                  onChange={(e) => {
                                    setManualPrices(prev => ({
                                      ...prev,
                                      [week.weekKey]: e.target.value
                                    }))
                                  }}
                                  onFocus={handleZeroFieldFocus}
                                  placeholder="0"
                                  className="w-28 p-2 border border-gray-300 rounded text-right"
                                />
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>

          {/* Apply Button */}
          <div className="mt-6 flex justify-between items-center pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              Click "Apply Prices" to save and proceed to planning.
            </p>
            <button
              onClick={() => {
                applyManualData()
                setActiveTab('planning')
              }}
              disabled={weeksWithPricesCount === 0}
              className={`py-3 px-6 rounded-lg font-semibold text-white transition-colors ${
                weeksWithPricesCount === 0
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              Apply Prices & Continue →
            </button>
          </div>
        </div>

        {/* Testing Tools */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <button
            onClick={() => setShowTestingTools(!showTestingTools)}
            className="w-full p-4 text-left flex items-center justify-between bg-gray-50 hover:bg-gray-100 border-b border-gray-200"
          >
            <span className="font-medium text-gray-600">Testing Tools</span>
            <span className="text-gray-400">{showTestingTools ? '▼' : '▶'}</span>
          </button>

          {showTestingTools && (
            <div className="p-4">
              <p className="text-sm text-gray-500 mb-4">
                Fill in sample prices for testing.
              </p>
              <button
                onClick={() => {
                  // Fill with sample seasonal pricing
                  const samplePrices = {}
                  generatedWeeks.forEach(week => {
                    const month = week.start.getMonth()
                    let price
                    if (month >= 5 && month <= 7) { // Jun-Aug
                      price = 4500 + Math.floor(Math.random() * 1000)
                    } else if (month >= 3 && month <= 4 || month >= 8 && month <= 9) { // Apr-May, Sep-Oct
                      price = 2500 + Math.floor(Math.random() * 500)
                    } else {
                      price = 1500 + Math.floor(Math.random() * 300)
                    }
                    samplePrices[week.key] = Math.round(price / 10) * 10
                  })
                  setManualPrices(prev => ({ ...prev, ...samplePrices }))
                }}
                className="py-2 px-4 bg-blue-100 text-blue-700 border border-blue-300 rounded-lg hover:bg-blue-200"
              >
                Fill Sample Prices
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Helper function to generate weeks for a year
  function generateWeeksForYear(year, weekStartDay = 6) {
    const weeks = []

    // Start from first occurrence of weekStartDay in the year
    let current = new Date(year, 0, 1)
    const dayOfWeek = current.getDay()
    const daysToAdd = (weekStartDay - dayOfWeek + 7) % 7
    current.setDate(current.getDate() + daysToAdd)

    // If that puts us in the previous year, move forward a week
    if (current.getFullYear() < year) {
      current.setDate(current.getDate() + 7)
    }

    // Generate weeks until we're past the year
    while (current.getFullYear() === year) {
      const weekStart = new Date(current)
      const weekEnd = new Date(current)
      weekEnd.setDate(weekEnd.getDate() + 7)

      const key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`

      weeks.push({
        start: weekStart,
        end: weekEnd,
        key
      })

      current.setDate(current.getDate() + 7)
    }

    return weeks
  }

  function renderCalendarGrid() {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-700">{pageTitle}</h3>
          <p className="text-sm text-gray-500">
            {sourceYear} Season - Rental weeks start on {settings?.weekStartDay !== undefined ? DAY_NAMES[settings.weekStartDay] : 'Saturday'}
          </p>
        </div>

        <div className="space-y-4">
          {months.map((month, monthIdx) => (
            <div key={monthIdx} className="border border-gray-200 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleMonth(monthIdx)}
                className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 flex justify-between items-center text-left"
              >
                <span className="font-semibold text-gray-700">
                  {month.month} {month.year}
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({month.weeks.length} weeks - ${calculateMonthTotal(month).toLocaleString()})
                  </span>
                </span>
                <span className="text-gray-500">
                  {expandedMonths[monthIdx] ? '▼' : '▶'}
                </span>
              </button>

              {expandedMonths[monthIdx] && (
                <div className="p-4">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="border border-gray-300 p-2 text-left">Week Dates</th>
                        {referenceYear && (
                          <th className="border border-gray-300 p-2 text-left w-28 text-gray-400">{referenceYear} Price</th>
                        )}
                        <th className="border border-gray-300 p-2 text-left w-32">Weekly Rate</th>
                        <th className="border border-gray-300 p-2 text-left w-28">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {month.weeks.map((week, weekIdx) => {
                        const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
                        const isClosed = isWeekClosedToGuests(weekDate)
                        return (
                          <tr
                            key={week.weekKey}
                            className={
                              isClosed ? 'bg-gray-100 text-gray-500 italic' :
                              week.needsManualEntry ? 'bg-yellow-100' :
                              week.status === 'booked' ? 'bg-red-50' : ''
                            }
                          >
                            <td className="border border-gray-300 p-2">
                              {formatWeekDates(week)}
                              {isClosed && (
                                <span className="ml-2 text-xs text-gray-600">(closed to guests)</span>
                              )}
                              {!isClosed && week.needsManualEntry && (
                                <span className="ml-2 text-xs text-yellow-700">(needs entry)</span>
                              )}
                            </td>
                          {referenceYear && (
                            <td className="border border-gray-300 p-2 text-gray-400">
                              {referencePrices[week.weekKey] ? formatPrice(referencePrices[week.weekKey]) : '-'}
                            </td>
                          )}
                          <td className="border border-gray-300 p-2">
                            <input
                              type="text"
                              value={week.price || ''}
                              onChange={(e) => updateWeekPrice(monthIdx, weekIdx, e.target.value)}
                              placeholder={week.needsManualEntry ? 'Enter price' : ''}
                              className={`w-full p-1 border rounded focus:outline-none focus:border-blue-500 ${
                                week.needsManualEntry && !week.price
                                  ? 'border-yellow-400 bg-yellow-50'
                                  : 'border-gray-300'
                              }`}
                            />
                          </td>
                          <td className="border border-gray-300 p-2">
                            {getStatusBadge(week.status)}
                          </td>
                        </tr>
                      )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-100 font-semibold">
                        <td className="border border-gray-300 p-2">Monthly Subtotal</td>
                        {referenceYear && <td className="border border-gray-300 p-2"></td>}
                        <td className="border border-gray-300 p-2" colSpan="2">
                          ${calculateMonthTotal(month).toLocaleString()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  function renderPlanningTab() {
    if (months.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">Import your calendar first to plan next year's pricing.</p>
          <button
            onClick={() => setActiveTab('import')}
            className="mt-4 py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Go to Import
          </button>
        </div>
      )
    }

    // Calculate year planning data - use original source months if year planning was applied
    const sourceMonthsData = yearPlanningApplied && originalSourceMonths.length > 0 ? originalSourceMonths : months
    const allWeeks = sourceMonthsData.flatMap(month => month.weeks)
    const sourceWeeks = allWeeks.filter(week => week.startDate?.year === sourceYear)

    if (sourceWeeks.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">No weeks found for {sourceYear}.</p>
        </div>
      )
    }

    const weekStart = settings?.weekStartDay ?? 6
    const mappings = mapWeeksByHolidays(sourceWeeks, sourceYear, targetYear, settings?.anchors || [], weekStart)

    // Detect conflicts FIRST so we can apply resolutions to the rows
    const conflicts = detectConflicts(mappings, targetYear, weekStart)
    const conflictsWithOptions = conflicts.filter(c => c.options && c.options.length > 0)
    const unresolvedConflicts = conflictsWithOptions.filter((conflict, idx) => {
      const key = `${conflict.type}-${idx}`
      return !conflictResolutions[key]
    })
    const hasUnresolvedConflicts = unresolvedConflicts.length > 0

    // Build lookup for collision resolutions (targetWeekKey -> resolved price)
    const collisionResolutions = {}
    const collisionTargetWeeks = new Set()
    conflicts.forEach((conflict, idx) => {
      if (conflict.type === 'collision') {
        collisionTargetWeeks.add(conflict.targetWeek)
        const resolution = conflictResolutions[`collision-${idx}`]
        if (resolution) {
          if (resolution.value === 'custom' && resolution.customPrice !== undefined) {
            collisionResolutions[conflict.targetWeek] = resolution.customPrice
          } else if (resolution.value !== 'custom') {
            collisionResolutions[conflict.targetWeek] = parsePrice(resolution.value)
          }
        }
      }
    })

    // Track which target weeks we've already added (to handle collision duplicates)
    const seenTargetWeeks = new Set()

    // Calculate prices with season adjustments (or use custom overrides)
    const rows = mappings.map(mapping => {
      const srcPrice = parsePrice(mapping.source?.price || mapping.proposedPrice)
      const targetStartDate = mapping.target?.start
      const season = targetStartDate ? getSeasonForDate(targetStartDate) : null
      const percentage = season?.percentage || 0
      const calculatedPrice = calculateAdjustedPrice(srcPrice, percentage)

      // Check if there's a custom override for this week
      const weekKey = mapping.target?.key
      const customPrice = weekKey && customProposedPrices[weekKey]

      // Check if there's a collision resolution for this week
      const collisionPrice = weekKey && collisionResolutions[weekKey]

      // Priority: custom override > collision resolution > calculated
      let proposedPrice = calculatedPrice
      let isCustom = false
      let isCollisionResolved = false

      if (customPrice !== undefined) {
        proposedPrice = customPrice
        isCustom = true
      } else if (collisionPrice !== undefined) {
        // Apply season adjustment to collision resolution price
        proposedPrice = calculateAdjustedPrice(collisionPrice, percentage)
        isCollisionResolved = true
      }

      const netChange = proposedPrice - srcPrice

      // Mark duplicates for collision weeks (first one wins for display)
      let isCollisionDuplicate = false
      if (weekKey && collisionTargetWeeks.has(weekKey)) {
        if (seenTargetWeeks.has(weekKey)) {
          isCollisionDuplicate = true
        } else {
          seenTargetWeeks.add(weekKey)
        }
      }

      return {
        ...mapping,
        sourcePrice: srcPrice,
        season,
        percentage,
        calculatedPrice,
        proposedPrice,
        isCustom,
        isCollisionResolved,
        isCollisionDuplicate,
        netChange
      }
    }).filter(row => !row.isCollisionDuplicate) // Filter out duplicate collision rows

    // Add rows for resolved gap conflicts
    conflicts.forEach((conflict, idx) => {
      if (conflict.type === 'gap') {
        const resolution = conflictResolutions[`gap-${idx}`]
        if (resolution) {
          let gapPrice = 0
          if (resolution.value === 'custom') {
            if (resolution.customPrice === undefined) return // Custom selected but no price entered yet
            gapPrice = resolution.customPrice
          } else if (resolution.value === 'interpolate' && resolution.interpolatedPrice) {
            gapPrice = parsePrice(resolution.interpolatedPrice)
          } else {
            gapPrice = parsePrice(resolution.value)
          }

          // Parse the target week key to create proper Date objects
          // Week key format is "year-month-day" (e.g., "2027-4-15")
          const keyParts = conflict.targetWeek.split('-').map(Number)
          const gapStart = new Date(keyParts[0], keyParts[1] - 1, keyParts[2])
          const gapEnd = new Date(gapStart)
          gapEnd.setDate(gapEnd.getDate() + 7)

          const season = getSeasonForDate(gapStart)
          const gapPercentage = season?.percentage || 0
          const adjustedGapPrice = calculateAdjustedPrice(gapPrice, gapPercentage)

          rows.push({
            source: null,
            sourceRange: '(Gap - no source)',
            target: {
              key: conflict.targetWeek,
              start: gapStart,
              end: gapEnd
            },
            targetRange: conflict.targetRange,
            sourcePrice: 0,
            season,
            percentage: gapPercentage,
            calculatedPrice: adjustedGapPrice,
            proposedPrice: adjustedGapPrice,
            isCustom: resolution.value === 'custom',
            isGapResolved: true,
            netChange: adjustedGapPrice
          })
        }
      }
    })

    // Sort rows by target date for consistent display
    rows.sort((a, b) => {
      const aKey = a.target?.key || ''
      const bKey = b.target?.key || ''
      return aKey.localeCompare(bKey)
    })

    const totalSourceRevenue = rows.reduce((sum, r) => sum + r.sourcePrice, 0)
    const totalProposedRevenue = rows.reduce((sum, r) => sum + r.proposedPrice, 0)
    const totalNetChange = totalProposedRevenue - totalSourceRevenue
    const percentChange = totalSourceRevenue > 0 ? ((totalNetChange / totalSourceRevenue) * 100).toFixed(1) : 0

    // Calculate weeks with missing prices (excluding closed weeks)
    const missingPriceWeeks = rows.filter(row => {
      if (row.isGapResolved) return false // Gap resolutions have prices
      // Exclude closed weeks
      if (row.target?.start) {
        const targetDate = row.target.start instanceof Date ? row.target.start : new Date(row.target.start)
        if (isWeekClosedToGuests(targetDate)) return false
      }
      const originalPrice = row.source?.price
      if (!originalPrice) return true
      const cleanPrice = String(originalPrice).replace(/[$,\s]/g, '')
      return cleanPrice === '' || cleanPrice === '0'
    })

    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            Plan {targetYear} Pricing (from {sourceYear} data)
          </h2>

          {/* Instructions Box */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-medium text-gray-700 mb-2">How to use this section:</h3>
            <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
              <li><strong>Holiday anchors:</strong> Shows how weeks align between years based on holidays (e.g., July 4th week → July 4th week).</li>
              <li><strong>Season adjustments:</strong> Set a percentage increase (or decrease) for each season.</li>
              <li><strong>Edit proposed prices:</strong> Click any proposed price to customize it directly.</li>
            </ol>
          </div>

          {/* Season Editor - Primary feature, shown first */}
          <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-md font-medium text-gray-700">Season Adjustments</h3>
              <button
                onClick={() => setActiveTab('settings')}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Edit Seasons
              </button>
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b border-blue-200">
                  <th className="py-2 pr-4">Season</th>
                  <th className="py-2 px-4">Dates</th>
                  <th className="py-2 px-4 text-right">% Adjust</th>
                  <th className="py-2 pl-4 text-center">Weekly Only</th>
                </tr>
              </thead>
              <tbody>
                {(settings?.seasons || DEFAULT_SETTINGS.seasons).map(season => (
                  <tr key={season.id} className="border-b border-blue-100">
                    <td className="py-2 pr-4 text-gray-700">{season.name}</td>
                    <td className="py-2 px-4 text-gray-500">
                      {MONTH_NAMES[season.startMonth - 1]} {season.startDay} - {MONTH_NAMES[season.endMonth - 1]} {season.endDay}
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          value={season.percentage}
                          onChange={(e) => {
                            const newSeasons = settings.seasons.map(s =>
                              s.id === season.id ? { ...s, percentage: parseFloat(e.target.value) || 0 } : s
                            )
                            saveSettings({ ...settings, seasons: newSeasons })
                          }}
                          onFocus={handleZeroFieldFocus}
                          className="w-16 p-1 border border-gray-300 rounded text-sm text-right"
                        />
                        <span className="text-gray-500">%</span>
                      </div>
                    </td>
                    <td className="py-2 pl-4 text-center">
                      <input
                        type="checkbox"
                        checked={season.weeklyOnly || false}
                        onChange={(e) => {
                          const newSeasons = settings.seasons.map(s =>
                            s.id === season.id ? { ...s, weeklyOnly: e.target.checked } : s
                          )
                          saveSettings({ ...settings, seasons: newSeasons })
                        }}
                        className="w-4 h-4"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Anchor Weeks - Collapsible, collapsed by default */}
          <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowHolidayAnchors(!showHolidayAnchors)}
              className="w-full p-4 bg-gray-50 hover:bg-gray-100 flex items-center justify-between text-left"
            >
              <div>
                <span className="font-bold text-gray-700">Anchor Weeks</span>
                <span className="text-gray-500 ml-2">Expand to view or add protected weeks</span>
              </div>
              <span className="text-gray-400">{showHolidayAnchors ? '▼' : '▶'}</span>
            </button>

            {showHolidayAnchors && (
              <div className="p-4 bg-white">
                <p className="text-sm text-gray-500 mb-3">
                  Weeks are matched between years based on their relationship to these holidays.
                </p>
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 p-2 text-left">Holiday</th>
                      <th className="border border-gray-300 p-2 text-center">{sourceYear} Date</th>
                      <th className="border border-gray-300 p-2 text-center">{sourceYear} Week</th>
                      <th className="border border-gray-300 p-2 text-center">{targetYear} Date</th>
                      <th className="border border-gray-300 p-2 text-center">{targetYear} Week</th>
                    </tr>
                  </thead>
                  <tbody>
                    {buildHolidayAnchorTable(sourceYear, targetYear, settings?.anchors || [], weekStart).map((anchor, idx) => (
                      <tr key={idx} className={anchor.type === 'custom' ? 'bg-purple-50' : ''}>
                        <td className="border border-gray-300 p-2">
                          {anchor.name}
                          {anchor.type === 'custom' && <span className="ml-1 text-xs text-purple-600">(custom)</span>}
                        </td>
                        <td className="border border-gray-300 p-2 text-center">{anchor.sourceDate}</td>
                        <td className="border border-gray-300 p-2 text-center text-gray-600">{anchor.sourceWeek}</td>
                        <td className="border border-gray-300 p-2 text-center">{anchor.targetDate}</td>
                        <td className="border border-gray-300 p-2 text-center text-gray-600">{anchor.targetWeek}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button
                  onClick={() => setActiveTab('settings')}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-700"
                >
                  + Add custom anchor dates in Settings
                </button>
              </div>
            )}
          </div>

          {/* Conflict Detection */}
          <div className={`mb-4 p-4 rounded-lg border ${conflicts.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-green-50 border-green-200'}`}>
            {conflicts.length > 0 ? (
              <>
                <h4 className="font-medium text-orange-800 mb-3">
                  ⚠️ {conflicts.length} Mapping Conflict{conflicts.length > 1 ? 's' : ''} Detected
                  {hasUnresolvedConflicts && (
                    <span className="ml-2 text-sm font-normal">
                      ({unresolvedConflicts.length} need{unresolvedConflicts.length === 1 ? 's' : ''} resolution)
                    </span>
                  )}
                </h4>
                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {conflicts.map((conflict, idx) => {
                    const isResolved = conflictResolutions[`${conflict.type}-${idx}`]
                    return (
                      <div key={idx} className={`p-3 bg-white rounded border ${isResolved ? 'border-green-200' : 'border-orange-100'}`}>
                        <div className="flex items-start justify-between">
                          <p className="text-sm text-gray-700 mb-2">{conflict.description}</p>
                          {isResolved && <span className="text-green-600 text-xs font-medium">✓ Resolved</span>}
                        </div>
                        {conflict.type === 'collision' && (
                          <div className="text-xs text-orange-600">
                            <strong>Collision:</strong> Multiple source weeks map to {conflict.targetRange}
                          </div>
                        )}
                        {conflict.type === 'gap' && (
                          <div className="text-xs text-orange-600">
                            <strong>Gap:</strong> No source week maps to {conflict.targetRange}
                          </div>
                        )}
                        {conflict.type === 'strategy_reversal' && (
                          <div className="text-xs text-orange-600">
                            <strong>Strategy Change:</strong> Relative pricing pattern may have reversed
                          </div>
                        )}
                        {conflict.options && conflict.options.length > 0 && (
                          <div className="mt-2">
                            <div className="flex flex-wrap gap-2">
                              {conflict.options.slice(0, 4).map((option, optIdx) => (
                                <button
                                  key={optIdx}
                                  onClick={() => {
                                    const newResolutions = { ...conflictResolutions }
                                    newResolutions[`${conflict.type}-${idx}`] = { ...option }
                                    setConflictResolutions(newResolutions)
                                    // Don't set customProposedPrices here - let the collision/gap logic handle it with season adjustments
                                  }}
                                  className={`text-xs px-2 py-1 rounded ${
                                    conflictResolutions[`${conflict.type}-${idx}`]?.value === option.value
                                      ? 'bg-green-600 text-white'
                                      : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                            {/* Custom price input when "Enter custom price" is selected */}
                            {conflictResolutions[`${conflict.type}-${idx}`]?.value === 'custom' && (
                              <div className="mt-2 flex items-center gap-2">
                                <span className="text-xs text-gray-600">Custom price:</span>
                                <span className="text-gray-400">$</span>
                                <input
                                  type="number"
                                  placeholder="Enter price"
                                  value={conflictResolutions[`${conflict.type}-${idx}`]?.customPrice || ''}
                                  onChange={(e) => {
                                    const customPrice = parseInt(e.target.value) || 0
                                    const newResolutions = { ...conflictResolutions }
                                    newResolutions[`${conflict.type}-${idx}`] = {
                                      ...conflictResolutions[`${conflict.type}-${idx}`],
                                      customPrice
                                    }
                                    setConflictResolutions(newResolutions)
                                    // Don't set customProposedPrices here - let the collision/gap logic handle it
                                  }}
                                  className="w-24 p-1 text-sm border border-gray-300 rounded"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2 text-green-700">
                <span className="text-xl">✓</span>
                <span className="font-medium">No Week Mapping Conflicts Detected</span>
                <span className="text-sm text-green-600 ml-2">All {sourceYear} weeks map cleanly to {targetYear}</span>
              </div>
            )}
          </div>

          {/* Missing Prices Warning */}
          {missingPriceWeeks.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4">
              <p className="text-red-700 font-medium">
                ⚠️ {missingPriceWeeks.length} week{missingPriceWeeks.length > 1 ? 's' : ''} missing prices
              </p>
              <p className="text-sm text-red-600 mt-1">
                {missingPriceWeeks.slice(0, 3).map(w => w.sourceRange || w.targetRange).join(', ')}
                {missingPriceWeeks.length > 3 && ` and ${missingPriceWeeks.length - 3} more...`}
              </p>
            </div>
          )}

          {/* Preview Table */}
          <div className="max-h-[400px] overflow-y-auto border border-gray-200 rounded-lg mb-4">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 bg-gray-100">
                <tr>
                  <th className="border border-gray-300 p-2 text-left">{sourceYear} Week</th>
                  <th className="border border-gray-300 p-2 text-right w-24">{sourceYear} Price</th>
                  <th className="border border-gray-300 p-2 text-center w-16">Adj %</th>
                  <th className="border border-gray-300 p-2 text-left">{targetYear} Week</th>
                  <th className="border border-gray-300 p-2 text-right w-32">{targetYear} Proposed</th>
                  <th className="border border-gray-300 p-2 text-right w-24">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const isMissingPrice = !row.isGapResolved && (!row.source?.price || String(row.source.price).replace(/[$,\s]/g, '') === '' || String(row.source.price).replace(/[$,\s]/g, '') === '0')
                  const rowBgClass = isMissingPrice ? 'bg-red-50' : row.error ? 'bg-red-50' : row.isGapResolved ? 'bg-blue-50' : row.isCollisionResolved ? 'bg-green-50' : row.isCustom ? 'bg-yellow-50' : ''
                  return (
                  <tr
                    key={idx}
                    data-missing-price={isMissingPrice ? 'true' : undefined}
                    className={rowBgClass}
                  >
                    <td className="border border-gray-300 p-2">{row.sourceRange}</td>
                    <td className="border border-gray-300 p-2 text-right">{formatPrice(row.sourcePrice)}</td>
                    <td className="border border-gray-300 p-2 text-center text-gray-500">
                      {row.isGapResolved ? 'Gap' : row.isCollisionResolved ? 'Resolved' : row.isCustom ? 'Custom' : `${row.percentage >= 0 ? '+' : ''}${row.percentage}%`}
                    </td>
                    <td className="border border-gray-300 p-2">
                      {row.target ? row.targetRange : <span className="text-red-600">{row.error}</span>}
                    </td>
                    <td className="border border-gray-300 p-1">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-gray-400">$</span>
                        <NumericInput
                          value={row.proposedPrice}
                          onChange={(e) => {
                            const newPrice = parseInt(e.target.value) || 0
                            const weekKey = row.target?.key
                            if (weekKey) {
                              if (newPrice === row.calculatedPrice) {
                                // Remove custom override if it matches calculated
                                const newCustom = { ...customProposedPrices }
                                delete newCustom[weekKey]
                                setCustomProposedPrices(newCustom)
                              } else {
                                setCustomProposedPrices(prev => ({ ...prev, [weekKey]: newPrice }))
                              }
                            }
                          }}
                          className={`w-20 p-1 border rounded text-right text-sm ${row.isCustom ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'}`}
                        />
                        {row.isCustom && (
                          <button
                            onClick={() => {
                              const newCustom = { ...customProposedPrices }
                              delete newCustom[row.target?.key]
                              setCustomProposedPrices(newCustom)
                            }}
                            className="text-gray-400 hover:text-gray-600"
                            title="Reset to calculated price"
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    </td>
                    <td className={`border border-gray-300 p-2 text-right ${
                      row.netChange > 0 ? 'text-green-600' : row.netChange < 0 ? 'text-red-600' : 'text-gray-500'
                    }`}>
                      {row.netChange > 0 ? '+' : ''}{formatPrice(row.netChange)}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="p-4 bg-gray-100 rounded-lg mb-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-sm text-gray-500">Total {sourceYear}</div>
                <div className="text-xl font-bold text-gray-700">{formatPrice(totalSourceRevenue)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Total {targetYear}</div>
                <div className="text-xl font-bold text-gray-700">{formatPrice(totalProposedRevenue)}</div>
              </div>
              <div>
                <div className="text-sm text-gray-500">Net Change</div>
                <div className={`text-xl font-bold ${totalNetChange > 0 ? 'text-green-600' : totalNetChange < 0 ? 'text-red-600' : 'text-gray-700'}`}>
                  {totalNetChange > 0 ? '+' : ''}{formatPrice(totalNetChange)} ({percentChange}%)
                </div>
              </div>
            </div>
          </div>

          {/* Scroll Indicator */}
          <p className="text-sm text-gray-500 text-center">↓ Scroll the table above to see all weeks and changes in real-time</p>

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => setActiveTab('import')}
              className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              ← Back: Import
            </button>

            {hasUnresolvedConflicts ? (
              <div className="flex items-center gap-3">
                <span className="text-orange-600 text-sm">
                  Resolve {unresolvedConflicts.length} conflict{unresolvedConflicts.length > 1 ? 's' : ''} above to continue
                </span>
                <button
                  disabled
                  className="py-3 px-6 bg-gray-300 text-gray-500 font-semibold rounded-lg cursor-not-allowed"
                >
                  Continue to Platform Pricing →
                </button>
              </div>
            ) : missingPriceWeeks.length > 0 ? (
              <button
                onClick={() => {
                  setMissingWeeksForModal(missingPriceWeeks.map(w => w.targetRange || w.sourceRange || 'Unknown'))
                  setMissingDataModalContext('platforms') // Set context for modal
                  setShowMissingDataModal(true)
                }}
                className="py-3 px-6 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg transition-colors"
              >
                Review Missing Weeks ({missingPriceWeeks.length})
              </button>
            ) : (
              <button
                onClick={() => applyYearPlanning(rows)}
                className="py-3 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
              >
                Apply & Continue to Platform Pricing →
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  function applyYearPlanning(rows) {
    // Preserve original source months before replacing
    if (months.length > 0) {
      setOriginalSourceMonths([...months])
    }

    // Save reference prices
    const refPrices = {}
    rows.forEach(row => {
      if (row.target?.key) {
        refPrices[row.target.key] = row.sourcePrice
      }
    })
    setReferencePrices(refPrices)
    setReferenceYear(sourceYear)

    // Group by month - with defensive checks for valid target data
    const monthMap = new Map()
    rows.forEach(row => {
      // Skip rows without target data
      if (!row.target?.start || !row.target?.end) return

      // Convert to Date objects if they're not already (handles serialized data)
      const targetStart = row.target.start instanceof Date
        ? row.target.start
        : new Date(row.target.start)
      const targetEnd = row.target.end instanceof Date
        ? row.target.end
        : new Date(row.target.end)

      // Skip if conversion failed (invalid date)
      if (isNaN(targetStart.getTime()) || isNaN(targetEnd.getTime())) return

      const monthName = targetStart.toLocaleString('en-US', { month: 'long' })
      const year = targetStart.getFullYear()
      const key = `${monthName}-${year}`

      if (!monthMap.has(key)) {
        monthMap.set(key, { month: monthName, year, weeks: [] })
      }

      monthMap.get(key).weeks.push({
        weekKey: row.target.key,
        startDate: {
          year: targetStart.getFullYear(),
          month: targetStart.getMonth(),
          day: targetStart.getDate()
        },
        endDate: {
          year: targetEnd.getFullYear(),
          month: targetEnd.getMonth(),
          day: targetEnd.getDate()
        },
        price: formatPrice(row.proposedPrice),
        status: 'available',
        season: row.season?.name
      })
    })

    const newMonths = Array.from(monthMap.values()).sort((a, b) => {
      const dateA = new Date(a.year, MONTH_NAMES_FULL.indexOf(a.month))
      const dateB = new Date(b.year, MONTH_NAMES_FULL.indexOf(b.month))
      return dateA - dateB
    })

    newMonths.forEach(month => {
      month.weeks.sort((a, b) => {
        const dateA = new Date(a.startDate.year, a.startDate.month, a.startDate.day)
        const dateB = new Date(b.startDate.year, b.startDate.month, b.startDate.day)
        return dateA - dateB
      })
    })

    setMonths(newMonths)
    setHasChanges(true)
    setYearPlanningApplied(true)
    setActiveTab('platforms')
  }

  function renderPlatformsTab() {
    if (months.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">Import your calendar first to see platform pricing.</p>
        </div>
      )
    }

    const enabledPlatforms = []
    if (settings?.platforms?.airbnb?.enabled) {
      enabledPlatforms.push({ key: 'airbnb', name: 'Airbnb', commission: settings.platforms.airbnb.commission })
    }
    if (settings?.platforms?.vrbo?.enabled) {
      enabledPlatforms.push({ key: 'vrbo', name: 'Vrbo', commission: settings.platforms.vrbo.commission })
    }
    settings?.platforms?.custom?.forEach((p, i) => {
      if (p.enabled) {
        enabledPlatforms.push({ key: `custom_${i}`, name: p.name, commission: p.commission })
      }
    })

    if (enabledPlatforms.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">No platforms configured. Go to Settings to add platforms.</p>
          <button
            onClick={() => setActiveTab('settings')}
            className="mt-4 py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
          >
            Go to Settings
          </button>
        </div>
      )
    }

    const allWeeks = months.flatMap(m => m.weeks)

    return (
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Platform Pricing Calculator</h2>
          <p className="text-gray-500 text-sm mb-4">
            These are the prices to LIST on each platform so you NET your target amount. Click any price to customize it.
          </p>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border border-gray-300 p-2 text-left">Week</th>
                  <th className="border border-gray-300 p-2 text-right">Target NET</th>
                  {enabledPlatforms.map(p => (
                    <th key={p.key} className="border border-gray-300 p-2 text-right">
                      {p.name} ({(p.commission * 100).toFixed(1)}%)
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // Group weeks by season - with defensive checks for malformed data
                  const seasons = settings?.seasons || DEFAULT_SETTINGS.seasons
                  const seasonGroups = {}

                  // Filter out weeks with missing startDate and closed weeks
                  const validWeeks = allWeeks.filter(week => {
                    if (week?.startDate?.year === undefined) return false
                    const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
                    return !isWeekClosedToGuests(weekDate)
                  })

                  validWeeks.forEach(week => {
                    const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
                    const season = getSeasonForDate(weekDate) || { id: 'other', name: 'Other', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31 }
                    if (!seasonGroups[season.id]) {
                      seasonGroups[season.id] = { season, weeks: [] }
                    }
                    seasonGroups[season.id].weeks.push(week)
                  })

                  // Determine which seasons to expand by default (current/upcoming)
                  const now = new Date()
                  const currentMonth = now.getMonth() + 1

                  return Object.values(seasonGroups).map(group => {
                    const seasonStartMonth = group.season.startMonth || 1
                    const seasonEndMonth = group.season.endMonth || 12
                    const isExpanded = expandedPlatformSeasons[group.season.id] !== undefined
                      ? expandedPlatformSeasons[group.season.id]
                      : (currentMonth >= seasonStartMonth && currentMonth <= seasonEndMonth) ||
                        (seasonStartMonth > currentMonth && seasonStartMonth <= currentMonth + 3)

                    return (
                      <Fragment key={group.season.id}>
                        <tr
                          className="bg-blue-50 cursor-pointer hover:bg-blue-100"
                          onClick={() => setExpandedPlatformSeasons(prev => ({
                            ...prev,
                            [group.season.id]: !isExpanded
                          }))}
                        >
                          <td colSpan={2 + enabledPlatforms.length} className="border border-gray-300 p-2 font-semibold text-blue-800">
                            <span className="mr-2">{isExpanded ? '▼' : '▶'}</span>
                            {group.season.name} ({MONTH_NAMES[(group.season.startMonth || 1) - 1]} {group.season.startDay || 1} - {MONTH_NAMES[(group.season.endMonth || 12) - 1]} {group.season.endDay || 31})
                            <span className="ml-2 text-sm font-normal text-blue-600">({group.weeks.length} weeks)</span>
                          </td>
                        </tr>
                        {isExpanded && group.weeks.map((week, idx) => {
                          if (!week?.startDate) return null // Skip malformed weeks
                          const netPrice = parsePrice(week.price)
                          return (
                            <tr key={week.weekKey || idx}>
                              <td className="border border-gray-300 p-2">{formatWeekDates(week)}</td>
                              <td className="border border-gray-300 p-2 text-right">{formatPrice(netPrice)}</td>
                              {enabledPlatforms.map(p => {
                                const calcListPrice = calculateListPrice(netPrice, p.commission)
                                const customKey = `${week.weekKey}_${p.key}`
                                const customPrice = customPlatformPrices[customKey]
                                const listPrice = customPrice !== undefined ? customPrice : calcListPrice
                                const isCustom = customPrice !== undefined
                                const actualNet = Math.floor(listPrice * (1 - p.commission))
                                const netDiff = actualNet - netPrice

                                return (
                                  <td key={p.key} className={`border border-gray-300 p-1 ${isCustom ? 'bg-yellow-50' : ''}`}>
                                    <div className="flex items-center justify-end gap-1">
                                      <span className="text-gray-400">$</span>
                                      <NumericInput
                                        value={listPrice}
                                        onChange={(e) => {
                                          const newPrice = parseInt(e.target.value) || 0
                                          if (newPrice === calcListPrice) {
                                            const newCustom = { ...customPlatformPrices }
                                            delete newCustom[customKey]
                                            setCustomPlatformPrices(newCustom)
                                          } else {
                                            setCustomPlatformPrices(prev => ({ ...prev, [customKey]: newPrice }))
                                          }
                                        }}
                                        className={`w-20 p-1 border rounded text-right text-sm font-semibold ${isCustom ? 'border-yellow-400' : 'border-gray-300'}`}
                                      />
                                    </div>
                                    {isCustom && netDiff !== 0 && (
                                      <div className={`text-xs text-right mt-1 ${netDiff >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        NET: ${actualNet.toLocaleString()} ({netDiff >= 0 ? '+' : ''}{netDiff})
                                      </div>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </Fragment>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => setActiveTab('planning')}
              className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              ← Back: Plan Next Year
            </button>
            <button
              onClick={() => setActiveTab('guide')}
              className="py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              NEXT: Entry Guide →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Entry Guide state
  const [selectedGuidePlatform, setSelectedGuidePlatform] = useState('airbnb')
  const [guideYear, setGuideYear] = useState(null)
  const [useAverageNightly, setUseAverageNightly] = useState(false)
  const [entryGuideView, setEntryGuideView] = useState('table') // 'table' or 'instructions'
  const [simplifyPricing, setSimplifyPricing] = useState(false)

  // Helper function to group consecutive weeks for Instructions View
  function groupConsecutiveWeeks(weeks, weights) {
    if (!weeks || weeks.length === 0) return []

    const groups = []
    let currentGroup = null

    weeks.forEach(week => {
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      const season = getSeasonForDate(weekDate)
      const isWeeklyOnly = season?.weeklyOnly
      const weeklyRate = parsePrice(week.price)

      if (isWeeklyOnly) {
        // Weekly-only: always individual
        if (currentGroup) {
          groups.push(currentGroup)
          currentGroup = null
        }
        groups.push({ type: 'weekly-only', weeklyRate, weeks: [week] })
      } else if (!currentGroup || currentGroup.weeklyRate !== weeklyRate) {
        // Start new group
        if (currentGroup) groups.push(currentGroup)
        currentGroup = { type: 'range', weeklyRate, weeks: [week] }
      } else {
        // Add to current group
        currentGroup.weeks.push(week)
      }
    })

    if (currentGroup) groups.push(currentGroup)

    // Mark single-week groups as 'unique'
    return groups.map(g => ({
      ...g,
      type: g.weeks.length === 1 && g.type !== 'weekly-only' ? 'unique' : g.type
    }))
  }

  // Render Instructions View for Entry Guide
  function renderInstructionsView(weeks, platform, weights, orderedDayKeys) {
    // ALWAYS group for both Airbnb and Vrbo - toggle only changes display format
    const groups = groupConsecutiveWeeks(weeks, weights)

    return (
      <div className="space-y-6">
        {/* Simplify Toggle - Airbnb Only */}
        {platform.key === 'airbnb' && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={simplifyPricing}
              onChange={(e) => setSimplifyPricing(e.target.checked)}
              className="w-4 h-4"
            />
            Use Base Rate + Weekend Pricing (flattens nightly pricing for easier input)
          </label>
        )}

        {/* Platform-specific instructions for each group */}
        {groups.map((group, idx) => {
          const firstWeek = group.weeks[0]
          const lastWeek = group.weeks[group.weeks.length - 1]
          const startDate = new Date(firstWeek.startDate.year, firstWeek.startDate.month, firstWeek.startDate.day)
          const endDate = new Date(lastWeek.endDate.year, lastWeek.endDate.month, lastWeek.endDate.day)
          const dateRange = group.weeks.length === 1
            ? `${formatWeekDates(firstWeek)}, ${firstWeek.startDate.year}`
            : `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

          const netPrice = group.weeklyRate
          const listPrice = calculateListPrice(netPrice, platform.commission)

          return (
            <div key={idx} className="p-4 border border-gray-200 rounded-lg bg-gray-50">
              <h4 className="font-semibold text-gray-800 mb-3">
                DATES: {dateRange}
                {group.type === 'weekly-only' && <span className="ml-2 text-purple-600">(Weekly Only)</span>}
                {group.type === 'range' && <span className="ml-2 text-gray-600">({group.weeks.length} weeks at {formatPrice(netPrice)}/week)</span>}
              </h4>

              {platform.key === 'airbnb' && renderAirbnbInstructions(group, listPrice, weights, orderedDayKeys)}
              {platform.key === 'vrbo' && renderVrboInstructions(group, listPrice, weights)}
              {platform.key.startsWith('custom_') && renderGenericInstructions(group, listPrice, weights, orderedDayKeys)}
            </div>
          )
        })}
      </div>
    )
  }

  // Airbnb-specific instructions
  function renderAirbnbInstructions(group, listPrice, weights, orderedDayKeys) {
    if (group.type === 'weekly-only') {
      const flatRate = Math.ceil(listPrice / 7)
      return (
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
          <li>Select the date range in your calendar</li>
          <li>Set nightly rate to <strong>${flatRate}</strong> for all 7 nights</li>
          <li>Set minimum stay to 7 nights</li>
        </ol>
      )
    }

    // Check toggle state for display format (both modes show grouped data)
    if (!simplifyPricing || group.type === 'unique') {
      // Toggle OFF (Granular) OR single week: Show full 7-day nightly breakdown
      const nightlyRates = calculateNightlyRates(listPrice, weights)
      const dayKeys = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']
      const dayNames = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']

      return (
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
          <li>Select the date range in your calendar</li>
          <li>Enter these custom nightly rates:
            <div className="mt-2 ml-6 grid grid-cols-7 gap-2 text-xs">
              {dayKeys.map((dayKey, i) => (
                <div key={i} className="text-center">
                  <div className="font-semibold">{dayNames[i]}</div>
                  <div className="text-gray-600">${nightlyRates[dayKey]}</div>
                </div>
              ))}
            </div>
          </li>
        </ol>
      )
    }

    // Toggle ON (Simple) for multi-week ranges: Base Rate + Weekend Increment
    const weekdayAvg = (weights.sunday + weights.monday + weights.tuesday + weights.wednesday + weights.thursday) / 5 / 100
    const weekendAvg = (weights.friday + weights.saturday) / 2 / 100
    const baseRate = Math.ceil(listPrice * weekdayAvg)
    const weekendIncrement = Math.ceil(listPrice * (weekendAvg - weekdayAvg))

    const calculatedWeekly = 7 * baseRate + 2 * weekendIncrement
    const weeklyDiscount = calculatedWeekly > listPrice
      ? Math.round((calculatedWeekly - listPrice) / calculatedWeekly * 100)
      : 0

    return (
      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
        <li>Go to Pricing Settings</li>
        <li>Set Base Nightly Rate to <strong>${baseRate}</strong></li>
        <li>Enable Weekend Pricing</li>
        <li>Set Weekend Increment to <strong>+${weekendIncrement}</strong></li>
        {weeklyDiscount > 0 && <li>Set Weekly Discount to <strong>{weeklyDiscount}%</strong></li>}
        <li>Select the date range in your calendar</li>
        <li>Confirm rates applied</li>
      </ol>
    )
  }

  // Vrbo-specific instructions
  function renderVrboInstructions(group, listPrice, weights) {
    if (group.type === 'weekly-only') {
      const flatRate = Math.ceil(listPrice / 7)
      return (
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
          <li>Select the date range in your calendar</li>
          <li>Set nightly rate to <strong>${flatRate}</strong> for all nights</li>
          <li>Set minimum stay to 7 nights</li>
        </ol>
      )
    }

    if (group.type === 'unique') {
      const nightlyRates = calculateNightlyRates(listPrice, weights)
      return (
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
          <li>Select the date range in your calendar</li>
          <li>Enter these nightly rates:
            <div className="mt-2 ml-6 space-y-1 text-xs">
              <div>Sunday: <strong>${nightlyRates.sunday}</strong></div>
              <div>Monday: <strong>${nightlyRates.monday}</strong></div>
              <div>Tuesday: <strong>${nightlyRates.tuesday}</strong></div>
              <div>Wednesday: <strong>${nightlyRates.wednesday}</strong></div>
              <div>Thursday: <strong>${nightlyRates.thursday}</strong></div>
              <div>Friday: <strong>${nightlyRates.friday}</strong></div>
              <div>Saturday: <strong>${nightlyRates.saturday}</strong></div>
            </div>
          </li>
        </ol>
      )
    }

    // Simplified range with day-of-week rates
    const dayRates = {
      sunday: Math.ceil(listPrice * weights.sunday / 100),
      monday: Math.ceil(listPrice * weights.monday / 100),
      tuesday: Math.ceil(listPrice * weights.tuesday / 100),
      wednesday: Math.ceil(listPrice * weights.wednesday / 100),
      thursday: Math.ceil(listPrice * weights.thursday / 100),
      friday: Math.ceil(listPrice * weights.friday / 100),
      saturday: Math.ceil(listPrice * weights.saturday / 100)
    }

    return (
      <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
        <li>Go to Calendar → Settings → Base rates and discounts</li>
        <li>Toggle 'Customize by night of week'</li>
        <li>Enter these day-of-week rates:
          <div className="mt-2 ml-6 space-y-1 text-xs">
            <div>Sunday: <strong>${dayRates.sunday}</strong></div>
            <div>Monday: <strong>${dayRates.monday}</strong></div>
            <div>Tuesday: <strong>${dayRates.tuesday}</strong></div>
            <div>Wednesday: <strong>${dayRates.wednesday}</strong></div>
            <div>Thursday: <strong>${dayRates.thursday}</strong></div>
            <div>Friday: <strong>${dayRates.friday}</strong></div>
            <div>Saturday: <strong>${dayRates.saturday}</strong></div>
          </div>
        </li>
        <li>Select date range in calendar</li>
        <li>Apply rates to selected range</li>
      </ol>
    )
  }

  // Generic instructions for custom platforms
  function renderGenericInstructions(group, listPrice, weights, orderedDayKeys) {
    if (group.type === 'weekly-only') {
      const flatRate = Math.ceil(listPrice / 7)
      return (
        <div className="text-sm text-gray-700">
          <p>Weekly rate: <strong>{formatPrice(listPrice)}</strong></p>
          <p>Flat nightly rate: <strong>${flatRate}/night</strong> (set minimum stay to 7 nights)</p>
        </div>
      )
    }

    const nightlyRates = calculateNightlyRates(listPrice, weights)
    return (
      <div className="text-sm text-gray-700">
        <p>Weekly rate: <strong>{formatPrice(listPrice)}</strong></p>
        <p className="mt-2">Suggested nightly breakdown:</p>
        <div className="mt-1 ml-4 space-y-1 text-xs">
          {orderedDayKeys.map((dayKey, i) => (
            <div key={i}>{dayKey}: ${nightlyRates[dayKey]}</div>
          ))}
        </div>
      </div>
    )
  }

  function renderGuideTab() {
    if (months.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">Import your calendar first to generate entry guides.</p>
        </div>
      )
    }

    const enabledPlatforms = []
    if (settings?.platforms?.airbnb?.enabled) {
      enabledPlatforms.push({ key: 'airbnb', name: 'Airbnb', commission: settings.platforms.airbnb.commission })
    }
    if (settings?.platforms?.vrbo?.enabled) {
      enabledPlatforms.push({ key: 'vrbo', name: 'Vrbo', commission: settings.platforms.vrbo.commission })
    }
    settings?.platforms?.custom?.forEach((p, i) => {
      if (p.enabled) {
        enabledPlatforms.push({ key: `custom_${i}`, name: p.name, commission: p.commission })
      }
    })

    if (enabledPlatforms.length === 0) {
      return (
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <p className="text-gray-500">No platforms configured. Go to Settings to add platforms.</p>
        </div>
      )
    }

    // Auto-select first platform if none selected
    if (!enabledPlatforms.find(p => p.key === selectedGuidePlatform)) {
      setSelectedGuidePlatform(enabledPlatforms[0].key)
    }

    const currentPlatform = enabledPlatforms.find(p => p.key === selectedGuidePlatform) || enabledPlatforms[0]

    // Combine weeks from current months AND originalSourceMonths (if year planning was applied)
    // This allows Entry Guide to show both source year (2026) and target year (2027)
    const currentWeeks = months.flatMap(m => m.weeks)
    const originalWeeks = yearPlanningApplied && originalSourceMonths.length > 0
      ? originalSourceMonths.flatMap(m => m.weeks)
      : []
    const allWeeks = [...currentWeeks, ...originalWeeks]

    // Get years from data - default to target year if available
    const years = [...new Set(allWeeks.map(w => w.startDate?.year))].filter(Boolean).sort()
    // Default to target year if it exists in data, otherwise use most recent year
    const defaultYear = targetYear && years.includes(targetYear) ? targetYear : years[years.length - 1]
    const displayYear = guideYear || defaultYear

    // Get day order based on week start day (F2)
    const weekStartDay = settings?.weekStartDay ?? 6 // Default Saturday
    const dayOrder = []
    for (let i = 0; i < 7; i++) {
      dayOrder.push((weekStartDay + i) % 7)
    }
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const orderedDayKeys = dayOrder.map(d => dayKeys[d])
    const orderedDayNames = dayOrder.map(d => DAY_NAMES_SHORT[d])

    // Filter weeks by selected year and exclude closed weeks
    const yearWeeksBeforeFilter = displayYear ? allWeeks.filter(w => w.startDate?.year === displayYear) : allWeeks
    const yearWeeks = yearWeeksBeforeFilter.filter(w => {
      const weekDate = new Date(w.startDate.year, w.startDate.month, w.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    const completedWeeks = entryProgress[currentPlatform.key]?.completedWeeks || []
    const completedCount = completedWeeks.filter(k => yearWeeks.some(w => w.weekKey === k)).length
    const totalCount = yearWeeks.length

    // Count weeks with missing prices (excluding closed weeks)
    const weeksWithMissingPrices = yearWeeks.filter(w => parsePrice(w.price) === 0)

    // Calculate nightly rates
    const weights = settings?.nightlyWeights || DEFAULT_SETTINGS.nightlyWeights

    return (
      <div className="space-y-6">
        {/* Instructions */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">Entry Guide</h2>
          <p className="text-gray-500 text-sm mb-4">
            Use this guide to update prices on your booking platforms.
          </p>

          <div className="bg-gray-50 rounded-lg p-4 text-sm">
            <strong>How to use:</strong>
            <ol className="list-decimal list-inside mt-2 space-y-1 text-gray-600">
              <li>Select which year to generate the guide for</li>
              <li>Switch between platform tabs (Airbnb, Vrbo, etc.)</li>
              <li>For each date range, enter the prices shown</li>
              <li>Check off rows as you complete them (optional - progress is saved)</li>
            </ol>
            <div className="mt-3 text-gray-500">
              <strong>Tips:</strong>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>For "Weekly Only" periods: Set minimum stay to 7 nights</li>
                <li>Where consecutive weeks have the same rate, select the full range and enter once</li>
              </ul>
            </div>
          </div>
        </div>

        {/* View Toggle - Table vs Instructions */}
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-4">
              <button
                onClick={() => setEntryGuideView('table')}
                className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                  entryGuideView === 'table'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Table View
              </button>
              <button
                onClick={() => setEntryGuideView('instructions')}
                className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                  entryGuideView === 'instructions'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                Instructions View
              </button>
            </nav>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex flex-wrap gap-6 items-center mb-4">
            {/* Year Selection */}
            <div>
              <label className="block text-sm text-gray-600 mb-1">Year:</label>
              <select
                value={displayYear || ''}
                onChange={(e) => setGuideYear(parseInt(e.target.value))}
                className="p-2 border border-gray-300 rounded-lg"
              >
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {/* Average Nightly Option */}
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={useAverageNightly}
                onChange={(e) => setUseAverageNightly(e.target.checked)}
                className="w-4 h-4"
              />
              Use average nightly rate (same rate all days)
            </label>
          </div>

          {/* Platform Tabs */}
          <div className="border-b border-gray-200 mb-4">
            <nav className="flex space-x-4">
              {enabledPlatforms.map(platform => (
                <button
                  key={platform.key}
                  onClick={() => setSelectedGuidePlatform(platform.key)}
                  className={`py-2 px-4 border-b-2 font-medium text-sm transition-colors ${
                    selectedGuidePlatform === platform.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {platform.name}
                </button>
              ))}
            </nav>
          </div>

          {/* Progress */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600">
              Progress: <strong>{completedCount}</strong> of <strong>{totalCount}</strong> weeks completed
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const allKeys = yearWeeks.map(w => w.weekKey)
                  saveEntryProgress(currentPlatform.key, [...new Set([...completedWeeks, ...allKeys])])
                }}
                className="py-1 px-3 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
              >
                Mark All Complete
              </button>
              <button
                onClick={() => saveEntryProgress(currentPlatform.key, [])}
                className="py-1 px-3 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
              >
                Reset Progress
              </button>
            </div>
          </div>

          {/* Platform-specific instructions */}
          <div className="bg-blue-50 rounded-lg p-3 mb-4 text-sm">
            {currentPlatform.key === 'airbnb' ? (
              <p><strong>Airbnb:</strong> Go to Host → Calendar → Click date range → Enter nightly rate</p>
            ) : currentPlatform.key === 'vrbo' ? (
              <p><strong>Vrbo:</strong> Go to Owner Dashboard → Calendar → Settings → Base rates</p>
            ) : (
              <p><strong>{currentPlatform.name}:</strong> Navigate to your calendar/pricing settings</p>
            )}
          </div>

          {/* Missing Prices Warning */}
          {weeksWithMissingPrices.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
              <p className="text-red-700 font-medium">
                ⚠️ {weeksWithMissingPrices.length} week{weeksWithMissingPrices.length > 1 ? 's' : ''} missing target prices
              </p>
              <p className="text-red-600 mt-1">
                Highlighted rows in red need prices set first. Go to the Planning tab to set base prices, or go to Import to enter prices manually.
              </p>
            </div>
          )}

          {/* TABLE VIEW */}
          {entryGuideView === 'table' && (
            <div className="border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border-b border-gray-200 p-2 text-left w-12">Done</th>
                  <th className="border-b border-gray-200 p-2 text-left">Dates</th>
                  <th className="border-b border-gray-200 p-2 text-right">Weekly</th>
                  {!useAverageNightly && orderedDayNames.map((name, i) => (
                    <th key={i} className="border-b border-gray-200 p-2 text-right">{name}</th>
                  ))}
                  {useAverageNightly && (
                    <th className="border-b border-gray-200 p-2 text-right">Nightly</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {yearWeeks.map((week, idx) => {
                  const netPrice = parsePrice(week.price)
                  const listPrice = calculateListPrice(netPrice, currentPlatform.commission)
                  const isCompleted = completedWeeks.includes(week.weekKey)
                  const season = getSeasonForDate(new Date(week.startDate.year, week.startDate.month, week.startDate.day))
                  const isWeeklyOnly = season?.weeklyOnly
                  const isMissingPrice = netPrice === 0

                  // Calculate nightly rates
                  const nightlyRates = calculateNightlyRates(listPrice, weights)
                  const avgNightly = Math.ceil(listPrice / 7)
                  // For weekly-only: flat nightly rate = weekly ÷ 7, rounded up (F3)
                  const flatNightlyRate = Math.ceil(listPrice / 7)

                  return (
                    <tr key={week.weekKey || idx} className={isMissingPrice ? 'bg-red-50' : isCompleted ? 'bg-green-50' : isWeeklyOnly ? 'bg-purple-50' : ''}>
                      <td className="border-b border-gray-200 p-2 text-center">
                        <input
                          type="checkbox"
                          checked={isCompleted}
                          onChange={(e) => {
                            const newCompleted = e.target.checked
                              ? [...completedWeeks, week.weekKey]
                              : completedWeeks.filter(k => k !== week.weekKey)
                            saveEntryProgress(currentPlatform.key, newCompleted)
                          }}
                          className="w-4 h-4"
                        />
                      </td>
                      <td className="border-b border-gray-200 p-2">
                        {formatWeekDates(week)}, {week.startDate.year}
                        {isWeeklyOnly && <span className="ml-2 text-xs text-purple-600">(weekly only)</span>}
                        {isMissingPrice && <span className="ml-2 text-xs text-red-600">(no price set)</span>}
                      </td>
                      <td className="border-b border-gray-200 p-2 text-right font-semibold">
                        {isMissingPrice ? (
                          <span className="text-red-500 text-xs">Set price first</span>
                        ) : (
                          formatPrice(listPrice)
                        )}
                      </td>
                      {!useAverageNightly && !isWeeklyOnly && !isMissingPrice && orderedDayKeys.map((dayKey, i) => (
                        <td key={i} className="border-b border-gray-200 p-2 text-right text-gray-600">
                          ${nightlyRates[dayKey]}
                        </td>
                      ))}
                      {!useAverageNightly && !isWeeklyOnly && isMissingPrice && (
                        <td className="border-b border-gray-200 p-2 text-right text-red-400 text-xs" colSpan={7}>
                          —
                        </td>
                      )}
                      {!useAverageNightly && isWeeklyOnly && !isMissingPrice && (
                        <td className="border-b border-gray-200 p-2 text-center text-purple-700" colSpan={7}>
                          <span className="font-semibold">${flatNightlyRate}/night</span>
                          <span className="text-xs text-purple-500 ml-2">(set min stay to 7 nights)</span>
                        </td>
                      )}
                      {!useAverageNightly && isWeeklyOnly && isMissingPrice && (
                        <td className="border-b border-gray-200 p-2 text-right text-red-400 text-xs" colSpan={7}>
                          —
                        </td>
                      )}
                      {useAverageNightly && !isMissingPrice && (
                        <td className="border-b border-gray-200 p-2 text-right text-gray-600">
                          ${avgNightly}/night
                        </td>
                      )}
                      {useAverageNightly && isMissingPrice && (
                        <td className="border-b border-gray-200 p-2 text-right text-red-400 text-xs">
                          —
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          )}

          {/* INSTRUCTIONS VIEW */}
          {entryGuideView === 'instructions' && renderInstructionsView(yearWeeks, currentPlatform, weights, orderedDayKeys)}

          {/* Export Buttons */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <h4 className="font-medium text-gray-700 mb-3">Export Entry Guide</h4>
            <div className="flex flex-wrap gap-3 mb-3">
              <button
                onClick={() => exportToCSV(yearWeeks, currentPlatform, orderedDayKeys, orderedDayNames, weights)}
                className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2"
              >
                <span>📄</span> Export {currentPlatform.name} CSV
              </button>
              <button
                onClick={() => exportAllPlatformsToCSV(yearWeeks, enabledPlatforms, orderedDayKeys, orderedDayNames, weights)}
                className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex items-center gap-2"
              >
                <span>📊</span> Export All Platforms CSV
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => exportToExcel(yearWeeks, enabledPlatforms, orderedDayKeys, orderedDayNames, weights, displayYear)}
                className="py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2"
              >
                <span>📗</span> Export to Excel
              </button>
              <span className="text-sm text-gray-500 self-center">(5 formats: Airbnb, Vrbo, Airbnb Granular, Airbnb Simple, Vrbo Simple for {displayYear})</span>
            </div>
          </div>

          {/* Navigation Buttons */}
          <div className="flex justify-between items-center mt-6 pt-6 border-t border-gray-200">
            <button
              onClick={() => setActiveTab('platforms')}
              className="py-2 px-6 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              ← Back: Platform Pricing
            </button>
            <button
              onClick={() => alert('All done! Your prices are ready to enter on each platform.')}
              className="py-3 px-6 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
            >
              ✓ Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Export to CSV function - single platform
  function exportToCSV(weeks, platform, dayKeys, dayNames, weights) {
    const rows = []

    // Header row
    const header = ['Platform', 'Week Start', 'Week End', 'Weekly Rate', ...dayNames, 'Notes']
    rows.push(header)

    // Filter out closed weeks
    const filteredWeeks = weeks.filter(week => {
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    // Data rows
    filteredWeeks.forEach(week => {
      const netPrice = parsePrice(week.price)
      const listPrice = calculateListPrice(netPrice, platform.commission)
      const nightlyRates = calculateNightlyRates(listPrice, weights)
      const season = getSeasonForDate(new Date(week.startDate.year, week.startDate.month, week.startDate.day))
      const isWeeklyOnly = season?.weeklyOnly
      const flatNightlyRate = Math.ceil(listPrice / 7)

      const startDate = `${week.startDate.year}-${String(week.startDate.month + 1).padStart(2, '0')}-${String(week.startDate.day).padStart(2, '0')}`
      const endDate = `${week.endDate.year}-${String(week.endDate.month + 1).padStart(2, '0')}-${String(week.endDate.day).padStart(2, '0')}`

      const row = [
        platform.name,
        startDate,
        endDate,
        listPrice,
        ...dayKeys.map(dk => isWeeklyOnly ? flatNightlyRate : nightlyRates[dk]),
        isWeeklyOnly ? 'Weekly only - set min stay 7 nights' : ''
      ]
      rows.push(row)
    })

    // Convert to CSV string
    const csvContent = rows.map(row => row.map(cell =>
      typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))
        ? `"${cell.replace(/"/g, '""')}"`
        : cell
    ).join(',')).join('\n')

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${platform.name.toLowerCase()}-pricing-${weeks[0]?.startDate?.year || 'export'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Export ALL platforms to CSV
  function exportAllPlatformsToCSV(weeks, platforms, dayKeys, dayNames, weights) {
    const rows = []

    // Filter out closed weeks
    const filteredWeeks = weeks.filter(week => {
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    // Build header: Week Start, Week End, Target NET, then for each platform: Platform Weekly, Platform Mon, Tue, etc.
    const header = ['Week Start', 'Week End', 'Target NET']
    platforms.forEach(p => {
      header.push(`${p.name} Weekly`)
      dayNames.forEach(d => header.push(`${p.name} ${d}`))
    })
    header.push('Notes')
    rows.push(header)

    // Data rows - one row per week, all platforms in that row
    filteredWeeks.forEach(week => {
      const netPrice = parsePrice(week.price)
      const season = getSeasonForDate(new Date(week.startDate.year, week.startDate.month, week.startDate.day))
      const isWeeklyOnly = season?.weeklyOnly

      const startDate = `${week.startDate.year}-${String(week.startDate.month + 1).padStart(2, '0')}-${String(week.startDate.day).padStart(2, '0')}`
      const endDate = `${week.endDate.year}-${String(week.endDate.month + 1).padStart(2, '0')}-${String(week.endDate.day).padStart(2, '0')}`

      const row = [startDate, endDate, netPrice]

      platforms.forEach(p => {
        const listPrice = calculateListPrice(netPrice, p.commission)
        const nightlyRates = calculateNightlyRates(listPrice, weights)
        const flatNightlyRate = Math.ceil(listPrice / 7)

        row.push(listPrice)
        dayKeys.forEach(dk => row.push(isWeeklyOnly ? flatNightlyRate : nightlyRates[dk]))
      })

      row.push(isWeeklyOnly ? 'Weekly only - set min stay 7 nights' : '')
      rows.push(row)
    })

    // Convert to CSV string
    const csvContent = rows.map(row => row.map(cell =>
      typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))
        ? `"${cell.replace(/"/g, '""')}"`
        : cell
    ).join(',')).join('\n')

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `all-platforms-pricing-${weeks[0]?.startDate?.year || 'export'}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Export to Excel with calendar-style formatted tabs for Airbnb and Vrbo
  async function exportToExcel(weeks, platforms, dayKeys, dayNames, weights, exportYear) {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'STR Pricing Updater'
    workbook.created = new Date()

    // Determine the year to export - use the year selected in Entry Guide
    const years = [...new Set(weeks.map(w => w.startDate?.year).filter(Boolean))]
    const targetYear = exportYear || Math.max(...years)
    const targetYearWeeks = weeks.filter(w => w.startDate?.year === targetYear)

    if (targetYearWeeks.length === 0) {
      alert('No pricing data available for export. Please apply year planning first.')
      return
    }

    // Build daily pricing map for target year
    const dailyPricing = buildDailyPricingMap(targetYearWeeks, platforms, weights)

    // Find Airbnb and Vrbo platforms
    const airbnb = platforms.find(p => p.key === 'airbnb')
    const vrbo = platforms.find(p => p.key === 'vrbo')

    if (!airbnb && !vrbo) {
      alert('No Airbnb or Vrbo platforms configured. Please enable at least one platform in settings.')
      return
    }

    // Create tabs in correct order: group by platform
    // Airbnb tabs
    if (airbnb) {
      createAirbnbTab(workbook, dailyPricing, targetYear, airbnb)
      createAirbnbGranularTab(workbook, targetYearWeeks, weights, airbnb)
      createAirbnbSimpleTab(workbook, targetYearWeeks, weights, airbnb)
    }

    // Vrbo tabs
    if (vrbo) {
      createVrboTab(workbook, dailyPricing, targetYear, vrbo)
      createVrboSimpleTab(workbook, targetYearWeeks, weights, vrbo)
    }

    // Generate and download
    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `STR-Pricing-${targetYear}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Helper function to build daily pricing map for a full year
  function buildDailyPricingMap(weeks, platforms, weights) {
    const dailyMap = {} // { 'YYYY-MM-DD': { airbnb: 350, vrbo: 320 } }

    // Filter out closed weeks
    const filteredWeeks = weeks.filter(week => {
      if (!week.startDate) return false
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    filteredWeeks.forEach(week => {
      if (!week.startDate || !week.price) return

      const netPrice = parsePrice(week.price)
      if (netPrice === 0) return

      // Generate all dates in this week
      const startDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      const endDate = new Date(week.endDate.year, week.endDate.month, week.endDate.day)

      // Calculate nightly rates for each platform
      platforms.forEach(platform => {
        const listPrice = calculateListPrice(netPrice, platform.commission)
        const nightlyRates = calculateNightlyRates(listPrice, weights)

        // Map nightly rates to each day of the week
        const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        let currentDate = new Date(startDate)
        let dayIndex = 0

        while (currentDate <= endDate && dayIndex < 7) {
          const dateKey = formatDateKey(currentDate)
          const dayOfWeek = currentDate.getDay() // 0=Sunday, 6=Saturday
          const dayKey = dayKeys[dayOfWeek]

          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = {}
          }
          dailyMap[dateKey][platform.key] = nightlyRates[dayKey]

          currentDate.setDate(currentDate.getDate() + 1)
          dayIndex++
        }
      })
    })

    return dailyMap
  }

  function formatDateKey(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Create Airbnb tab with horizontal scroll format
  function createAirbnbTab(workbook, dailyPricing, year, platform) {
    const sheet = workbook.addWorksheet('Airbnb')

    // Generate all dates for the year
    const startDate = new Date(year, 0, 1)
    const endDate = new Date(year, 11, 31)
    const dates = []
    let current = new Date(startDate)

    while (current <= endDate) {
      dates.push(new Date(current))
      current.setDate(current.getDate() + 1)
    }

    // Row 1: Month names (merged across their date columns)
    let colIndex = 1
    let currentMonth = -1
    let monthStartCol = 1

    dates.forEach((date, index) => {
      const month = date.getMonth()
      if (month !== currentMonth) {
        // Finish previous month merge
        if (currentMonth !== -1) {
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
          if (monthStartCol < colIndex) {
            sheet.mergeCells(1, monthStartCol, 1, colIndex - 1)
          }
          const monthCell = sheet.getCell(1, monthStartCol)
          monthCell.value = monthNames[currentMonth]
          monthCell.font = { bold: true, size: 12 }
          monthCell.alignment = { horizontal: 'center', vertical: 'middle' }
          monthCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4F8' } }
        }
        currentMonth = month
        monthStartCol = colIndex
      }
      colIndex++
    })

    // Finish last month
    if (currentMonth !== -1) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
      if (monthStartCol < colIndex) {
        sheet.mergeCells(1, monthStartCol, 1, colIndex - 1)
      }
      const monthCell = sheet.getCell(1, monthStartCol)
      monthCell.value = monthNames[currentMonth]
      monthCell.font = { bold: true, size: 12 }
      monthCell.alignment = { horizontal: 'center', vertical: 'middle' }
      monthCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4F8' } }
    }

    // Row 2: Day of week abbreviations
    const dayAbbrevs = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    dates.forEach((date, index) => {
      const cell = sheet.getCell(2, index + 1)
      cell.value = dayAbbrevs[date.getDay()]
      cell.font = { bold: true, size: 10 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    // Row 3: Day numbers
    dates.forEach((date, index) => {
      const cell = sheet.getCell(3, index + 1)
      cell.value = date.getDate()
      cell.font = { bold: true, size: 10 }
      cell.alignment = { horizontal: 'center', vertical: 'middle' }
    })

    // Row 4: Nightly prices
    dates.forEach((date, index) => {
      const dateKey = formatDateKey(date)
      const cell = sheet.getCell(4, index + 1)
      const price = dailyPricing[dateKey]?.[platform.key]

      if (price) {
        cell.value = price
        cell.numFmt = '$#,##0'
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      } else {
        cell.value = '—'
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
      }

      // Add thick border on Saturday columns (day 6)
      if (date.getDay() === 6) {
        cell.border = {
          right: { style: 'medium', color: { argb: 'FF000000' } }
        }
      }
    })

    // Set column widths
    dates.forEach((date, index) => {
      sheet.getColumn(index + 1).width = 9
    })

    // Set row heights
    sheet.getRow(1).height = 20
    sheet.getRow(2).height = 18
    sheet.getRow(3).height = 18
    sheet.getRow(4).height = 20
  }

  // Create Vrbo tab with monthly calendar pages format
  function createVrboTab(workbook, dailyPricing, year, platform) {
    const sheet = workbook.addWorksheet('Vrbo')

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    let currentRow = 1

    // Create a calendar block for each month
    for (let month = 0; month < 12; month++) {
      const firstDay = new Date(year, month, 1)
      const lastDay = new Date(year, month + 1, 0)
      const startDayOfWeek = firstDay.getDay() // 0=Sunday
      const daysInMonth = lastDay.getDate()

      // Month header (merged across 7 columns)
      sheet.mergeCells(currentRow, 1, currentRow, 7)
      const monthHeaderCell = sheet.getCell(currentRow, 1)
      monthHeaderCell.value = `${monthNames[month]} ${year}`
      monthHeaderCell.font = { bold: true, size: 14 }
      monthHeaderCell.alignment = { horizontal: 'center', vertical: 'middle' }
      monthHeaderCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
      monthHeaderCell.font.color = { argb: 'FFFFFFFF' }
      sheet.getRow(currentRow).height = 25
      currentRow++

      // Day headers row
      dayHeaders.forEach((dayName, colIndex) => {
        const cell = sheet.getCell(currentRow, colIndex + 1)
        cell.value = dayName
        cell.font = { bold: true, size: 11 }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F4F8' } }
      })
      sheet.getRow(currentRow).height = 20
      currentRow++

      // Calendar grid (up to 6 rows for weeks)
      let dayNum = 1
      const weeksNeeded = Math.ceil((startDayOfWeek + daysInMonth) / 7)

      for (let week = 0; week < weeksNeeded; week++) {
        for (let dayCol = 0; dayCol < 7; dayCol++) {
          const cell = sheet.getCell(currentRow, dayCol + 1)

          // Determine if this cell has a day number
          const dayIndex = week * 7 + dayCol
          const shouldShowDay = dayIndex >= startDayOfWeek && dayNum <= daysInMonth

          if (shouldShowDay) {
            const date = new Date(year, month, dayNum)
            const dateKey = formatDateKey(date)
            const price = dailyPricing[dateKey]?.[platform.key]

            // Cell content: day number on line 1, price on line 2
            const dayText = String(dayNum)
            const priceText = price ? `$${price.toLocaleString()}` : '—'

            cell.value = `${dayText}\n${priceText}`
            cell.alignment = { wrapText: true, vertical: 'top', horizontal: 'center' }
            cell.font = { size: 10 }

            dayNum++
          } else {
            cell.value = ''
          }

          // Add borders
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            right: { style: 'thin', color: { argb: 'FFD0D0D0' } }
          }
        }

        sheet.getRow(currentRow).height = 40
        currentRow++
      }

      // Add 2 empty rows between months
      currentRow += 2
    }

    // Set column widths for all 7 day columns
    for (let col = 1; col <= 7; col++) {
      sheet.getColumn(col).width = 14
    }
  }

  // Create Airbnb Granular tab (week-by-week INSTRUCTIONS with all 7 nightly rates)
  function createAirbnbGranularTab(workbook, weeks, weights, platform) {
    const sheet = workbook.addWorksheet('Airbnb Granular')

    // Filter out closed weeks
    const filteredWeeks = weeks.filter(week => {
      if (!week.startDate) return false
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    // Group consecutive weeks with same rate
    const groups = groupConsecutiveWeeks(filteredWeeks, weights)

    // Set column A to wide width for instructions
    sheet.getColumn(1).width = 85

    let row = 1

    // Instructions for each group
    groups.forEach((group, idx) => {
      const firstWeek = group.weeks[0]
      const lastWeek = group.weeks[group.weeks.length - 1]
      const startDate = new Date(firstWeek.startDate.year, firstWeek.startDate.month, firstWeek.startDate.day)
      const endDate = new Date(lastWeek.endDate.year, lastWeek.endDate.month, lastWeek.endDate.day)

      const netPrice = group.weeklyRate
      const listPrice = calculateListPrice(netPrice, platform.commission)
      const nightlyRates = calculateNightlyRates(listPrice, weights)

      // Title row
      const titleCell = sheet.getCell(row, 1)
      if (group.weeks.length === 1) {
        titleCell.value = `DATES: ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ($${netPrice.toLocaleString()}/week)${group.type === 'weekly-only' ? ' [Weekly Only]' : ''}`
      } else {
        titleCell.value = `DATES: ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${group.weeks.length} weeks at $${netPrice.toLocaleString()}/week)`
      }
      titleCell.font = { bold: true, size: 12 }
      row++

      // Empty row
      row++

      // Handle weekly-only groups
      if (group.type === 'weekly-only') {
        const flatRate = Math.ceil(listPrice / 7)
        sheet.getCell(row, 1).value = `Step 1: Select ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} in your calendar`
        row++
        sheet.getCell(row, 1).value = `Step 2: Set nightly rate to $${flatRate.toLocaleString()} for all 7 nights`
        row++
        sheet.getCell(row, 1).value = 'Step 3: Set minimum stay to 7 nights'
        row++
      } else {
        // All other groups: Show granular nightly rates
        sheet.getCell(row, 1).value = `Step 1: Select ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} in your Airbnb calendar`
        row++

        sheet.getCell(row, 1).value = 'Step 2: Enter these custom nightly rates:'
        row++

        // Day-by-day rates (starting with Saturday for rental weeks)
        const dayNames = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        const dayKeys = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']

        dayKeys.forEach((key, i) => {
          sheet.getCell(row, 1).value = `   ${dayNames[i]}: $${nightlyRates[key].toLocaleString()}`
          row++
        })
      }

      // Separator (3 empty rows)
      row += 3
    })

    // Freeze first column for easier scrolling
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 0 }]
  }

  // Create Airbnb Simple tab (Base Rate + Weekend Increment INSTRUCTIONS)
  function createAirbnbSimpleTab(workbook, weeks, weights, platform) {
    const sheet = workbook.addWorksheet('Airbnb Simple')

    // Filter out closed weeks
    const filteredWeeks = weeks.filter(week => {
      if (!week.startDate) return false
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    // Group consecutive weeks with same rate
    const groups = groupConsecutiveWeeks(filteredWeeks, weights)

    // Set column A to wide width for instructions
    sheet.getColumn(1).width = 85

    let row = 1

    // Instructions for each group
    groups.forEach((group, idx) => {
      const firstWeek = group.weeks[0]
      const lastWeek = group.weeks[group.weeks.length - 1]
      const startDate = new Date(firstWeek.startDate.year, firstWeek.startDate.month, firstWeek.startDate.day)
      const endDate = new Date(lastWeek.endDate.year, lastWeek.endDate.month, lastWeek.endDate.day)

      const netPrice = group.weeklyRate
      const listPrice = calculateListPrice(netPrice, platform.commission)

      // Calculate Base Rate + Weekend Increment
      const weekdayAvg = (weights.sunday + weights.monday + weights.tuesday + weights.wednesday + weights.thursday) / 5 / 100
      const weekendAvg = (weights.friday + weights.saturday) / 2 / 100
      const baseRate = Math.ceil(listPrice * weekdayAvg)
      const weekendIncrement = Math.ceil(listPrice * (weekendAvg - weekdayAvg))

      // Calculate nightly rates for potential granular display
      const nightlyRates = calculateNightlyRates(listPrice, weights)

      // Title row
      const titleCell = sheet.getCell(row, 1)
      if (group.weeks.length === 1) {
        titleCell.value = `DATES: ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ($${netPrice.toLocaleString()}/week)${group.type === 'weekly-only' ? ' [Weekly Only]' : ''}`
      } else {
        titleCell.value = `DATES: ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${group.weeks.length} weeks at $${netPrice.toLocaleString()}/week)`
      }
      titleCell.font = { bold: true, size: 12 }
      row++

      // Empty row
      row++

      // Instructions vary by group type
      if (group.type === 'weekly-only') {
        // Weekly-only weeks: flat rate
        const flatRate = Math.ceil(listPrice / 7)
        sheet.getCell(row, 1).value = `Step 1: Select ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} in your calendar`
        row++
        sheet.getCell(row, 1).value = `Step 2: Set nightly rate to $${flatRate.toLocaleString()} for all 7 nights`
        row++
        sheet.getCell(row, 1).value = 'Step 3: Set minimum stay to 7 nights'
        row++
      } else if (group.weeks.length > 1) {
        // Grouped weeks: Base + Increment
        sheet.getCell(row, 1).value = 'Step 1: Go to Pricing Settings'
        row++
        sheet.getCell(row, 1).value = `Step 2: Set Base Nightly Rate to $${baseRate.toLocaleString()}`
        row++
        sheet.getCell(row, 1).value = 'Step 3: Enable Weekend Pricing'
        row++
        sheet.getCell(row, 1).value = `Step 4: Set Weekend Increment to +$${weekendIncrement.toLocaleString()}`
        row++
        sheet.getCell(row, 1).value = `Step 5: Select the date range ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} in your calendar`
        row++
        sheet.getCell(row, 1).value = 'Step 6: Confirm rates applied'
        row++
      } else {
        // Single week: Granular nightly rates
        sheet.getCell(row, 1).value = `Step 1: Select ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} in your Airbnb calendar`
        row++
        sheet.getCell(row, 1).value = 'Step 2: Enter these custom nightly rates:'
        row++

        const dayNames = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        const dayKeys = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday']

        dayKeys.forEach((key, i) => {
          sheet.getCell(row, 1).value = `   ${dayNames[i]}: $${nightlyRates[key].toLocaleString()}`
          row++
        })
      }

      // Separator (3 empty rows)
      row += 3
    })

    // Freeze first column
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 0 }]
  }

  // Create Vrbo Simple tab (Day-of-week rates INSTRUCTIONS by date range)
  function createVrboSimpleTab(workbook, weeks, weights, platform) {
    const sheet = workbook.addWorksheet('Vrbo Simple')

    // Filter out closed weeks
    const filteredWeeks = weeks.filter(week => {
      if (!week.startDate) return false
      const weekDate = new Date(week.startDate.year, week.startDate.month, week.startDate.day)
      return !isWeekClosedToGuests(weekDate)
    })

    // Group consecutive weeks with same rate
    const groups = groupConsecutiveWeeks(filteredWeeks, weights)

    // Set column A to wide width for instructions
    sheet.getColumn(1).width = 85

    let row = 1

    // Instructions for each group
    groups.forEach((group, idx) => {
      const firstWeek = group.weeks[0]
      const lastWeek = group.weeks[group.weeks.length - 1]
      const startDate = new Date(firstWeek.startDate.year, firstWeek.startDate.month, firstWeek.startDate.day)
      const endDate = new Date(lastWeek.endDate.year, lastWeek.endDate.month, lastWeek.endDate.day)

      const netPrice = group.weeklyRate
      const listPrice = calculateListPrice(netPrice, platform.commission)

      // Calculate day-of-week rates
      const dayRates = {
        sunday: Math.ceil(listPrice * weights.sunday / 100),
        monday: Math.ceil(listPrice * weights.monday / 100),
        tuesday: Math.ceil(listPrice * weights.tuesday / 100),
        wednesday: Math.ceil(listPrice * weights.wednesday / 100),
        thursday: Math.ceil(listPrice * weights.thursday / 100),
        friday: Math.ceil(listPrice * weights.friday / 100),
        saturday: Math.ceil(listPrice * weights.saturday / 100)
      }

      // Title row
      const titleCell = sheet.getCell(row, 1)
      if (group.weeks.length === 1) {
        titleCell.value = `DATES: ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ($${netPrice.toLocaleString()}/week)${group.type === 'weekly-only' ? ' [Weekly Only]' : ''}`
      } else {
        titleCell.value = `DATES: ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} (${group.weeks.length} weeks at $${netPrice.toLocaleString()}/week)`
      }
      titleCell.font = { bold: true, size: 12 }
      row++

      // Empty row
      row++

      // Instructions vary by group type
      if (group.type === 'weekly-only') {
        // Weekly-only: flat rate
        const flatRate = Math.ceil(listPrice / 7)
        sheet.getCell(row, 1).value = `Step 1: Select ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} in your calendar`
        row++
        sheet.getCell(row, 1).value = `Step 2: Set nightly rate to $${flatRate.toLocaleString()} for all 7 nights`
        row++
        sheet.getCell(row, 1).value = 'Step 3: Set minimum stay to 7 nights'
        row++
      } else {
        // Regular weeks: day-of-week rates
        sheet.getCell(row, 1).value = 'Step 1: Go to Calendar > Settings > Base rates and discounts'
        row++
        sheet.getCell(row, 1).value = "Step 2: Toggle 'Customize by night of week'"
        row++
        sheet.getCell(row, 1).value = 'Step 3: Enter these day-of-week rates:'
        row++

        // Day-of-week rates
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

        dayKeys.forEach((key, i) => {
          sheet.getCell(row, 1).value = `   ${dayNames[i]}: $${dayRates[key].toLocaleString()}`
          row++
        })

        sheet.getCell(row, 1).value = `Step 4: Select date range ${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        row++
        sheet.getCell(row, 1).value = 'Step 5: Apply rates to selected range'
        row++
      }

      // Separator (3 empty rows)
      row += 3
    })

    // Freeze first column
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 0 }]
  }

  function renderSettingsTab() {
    if (!settings) return null

    const weekStartDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    return (
      <div className="space-y-6">
        {/* Save Indicator */}
        {settingsSaved && (
          <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 z-50 animate-pulse">
            <span>✓</span> Settings Saved
          </div>
        )}

        {/* Pricing Source */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-semibold text-gray-700">Pricing Source</h3>
            <button
              onClick={() => {
                saveSettings(settings)
                setSectionSaved(prev => ({ ...prev, pricingSource: Date.now() }))
                setTimeout(() => setSectionSaved(prev => ({ ...prev, pricingSource: null })), 2000)
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                sectionSaved.pricingSource
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {sectionSaved.pricingSource ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={settings.pricingSource === 'wnav'}
                onChange={() => setSettings(s => ({ ...s, pricingSource: 'wnav' }))}
                className="w-4 h-4"
              />
              <span>WeNeedAVacation (WNAV)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={settings.pricingSource === 'manual'}
                onChange={() => setSettings(s => ({ ...s, pricingSource: 'manual' }))}
                className="w-4 h-4"
              />
              <span>Manual Entry</span>
            </label>
          </div>
        </div>

        {/* Week Start Day */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-semibold text-gray-700">Rental Week Start Day</h3>
            <button
              onClick={() => {
                saveSettings(settings)
                setSectionSaved(prev => ({ ...prev, weekStartDay: Date.now() }))
                setTimeout(() => setSectionSaved(prev => ({ ...prev, weekStartDay: null })), 2000)
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                sectionSaved.weekStartDay
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {sectionSaved.weekStartDay ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-3">Which day do your rental weeks begin?</p>
          <select
            value={settings.weekStartDay ?? 6}
            onChange={(e) => setSettings(s => ({ ...s, weekStartDay: parseInt(e.target.value) }))}
            className="p-2 border border-gray-300 rounded-lg"
          >
            {weekStartDayNames.map((name, idx) => (
              <option key={idx} value={idx}>{name}</option>
            ))}
          </select>
        </div>

        {/* Platforms & Commissions */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-semibold text-gray-700">Platforms & Commissions</h3>
            <button
              onClick={() => {
                saveSettings(settings)
                setSectionSaved(prev => ({ ...prev, platforms: Date.now() }))
                setTimeout(() => setSectionSaved(prev => ({ ...prev, platforms: null })), 2000)
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                sectionSaved.platforms
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {sectionSaved.platforms ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 p-2 text-left">Platform</th>
                <th className="border border-gray-300 p-2 text-center w-20">Enabled</th>
                <th className="border border-gray-300 p-2 text-left w-32">Commission</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 p-2">WNAV</td>
                <td className="border border-gray-300 p-2 text-center">
                  <input type="checkbox" checked={settings.platforms?.wnav?.enabled} disabled className="w-4 h-4" />
                </td>
                <td className="border border-gray-300 p-2 text-gray-500">0%</td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2">Airbnb</td>
                <td className="border border-gray-300 p-2 text-center">
                  <input
                    type="checkbox"
                    checked={settings.platforms?.airbnb?.enabled}
                    onChange={(e) => setSettings(s => ({
                      ...s,
                      platforms: {
                        ...s.platforms,
                        airbnb: { ...s.platforms.airbnb, enabled: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4"
                  />
                </td>
                <td className="border border-gray-300 p-2">
                  <div className="flex items-center gap-1">
                    <NumericInput
                      step={0.1}
                      value={(settings.platforms?.airbnb?.commission || 0) * 100}
                      onChange={(e) => setSettings(s => ({
                        ...s,
                        platforms: {
                          ...s.platforms,
                          airbnb: { ...s.platforms.airbnb, commission: parseFloat(e.target.value) / 100 }
                        }
                      }))}
                      className="w-16 p-1 border border-gray-300 rounded text-right"
                    />
                    <span>%</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td className="border border-gray-300 p-2">Vrbo</td>
                <td className="border border-gray-300 p-2 text-center">
                  <input
                    type="checkbox"
                    checked={settings.platforms?.vrbo?.enabled}
                    onChange={(e) => setSettings(s => ({
                      ...s,
                      platforms: {
                        ...s.platforms,
                        vrbo: { ...s.platforms.vrbo, enabled: e.target.checked }
                      }
                    }))}
                    className="w-4 h-4"
                  />
                </td>
                <td className="border border-gray-300 p-2">
                  <div className="flex items-center gap-1">
                    <NumericInput
                      step={0.1}
                      value={(settings.platforms?.vrbo?.commission || 0) * 100}
                      onChange={(e) => setSettings(s => ({
                        ...s,
                        platforms: {
                          ...s.platforms,
                          vrbo: { ...s.platforms.vrbo, commission: parseFloat(e.target.value) / 100 }
                        }
                      }))}
                      className="w-16 p-1 border border-gray-300 rounded text-right"
                    />
                    <span>%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Seasons Editor */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-semibold text-gray-700">Season Definitions</h3>
            <button
              onClick={() => {
                saveSettings(settings)
                setSectionSaved(prev => ({ ...prev, seasons: Date.now() }))
                setTimeout(() => setSectionSaved(prev => ({ ...prev, seasons: null })), 2000)
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                sectionSaved.seasons
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {sectionSaved.seasons ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">Define your pricing seasons. Each season can have a different price adjustment and booking rules.</p>

          {(settings.seasons || []).length === 0 && !isAddingSeason && (
            <p className="text-gray-400 text-sm mb-4">No seasons defined.</p>
          )}

          {(settings.seasons || []).length > 0 && (
            <div className="mb-3 space-y-2">
              {settings.seasons.map((season, idx) => (
                <div key={season.id} className="flex items-center gap-2 p-3 bg-gray-50 rounded border border-gray-200">
                  <input
                    type="text"
                    value={season.name}
                    onChange={(e) => {
                      const newSeasons = [...settings.seasons]
                      newSeasons[idx] = { ...season, name: e.target.value }
                      saveSettings({ ...settings, seasons: newSeasons })
                    }}
                    className="flex-1 min-w-[120px] p-2 border border-gray-300 rounded"
                    placeholder="Season Name"
                  />
                  <div className="flex items-center gap-1">
                    <select
                      value={season.startMonth}
                      onChange={(e) => {
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, startMonth: parseInt(e.target.value) }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="p-2 border border-gray-300 rounded text-sm"
                    >
                      {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                    </select>
                    <NumericInput
                      min={1}
                      max={31}
                      value={season.startDay}
                      onChange={(e) => {
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, startDay: parseInt(e.target.value) || 1 }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="w-14 p-2 border border-gray-300 rounded text-center"
                    />
                  </div>
                  <span className="text-gray-500">to</span>
                  <div className="flex items-center gap-1">
                    <select
                      value={season.endMonth}
                      onChange={(e) => {
                        const newEndMonth = parseInt(e.target.value)
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, endMonth: newEndMonth }
                        // Auto-update next season's start date
                        if (idx < newSeasons.length - 1) {
                          const endDate = new Date(2000, newEndMonth - 1, season.endDay)
                          endDate.setDate(endDate.getDate() + 1)
                          newSeasons[idx + 1] = {
                            ...newSeasons[idx + 1],
                            startMonth: endDate.getMonth() + 1,
                            startDay: endDate.getDate()
                          }
                        }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="p-2 border border-gray-300 rounded text-sm"
                    >
                      {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                    </select>
                    <NumericInput
                      min={1}
                      max={31}
                      value={season.endDay}
                      onChange={(e) => {
                        const newEndDay = parseInt(e.target.value) || 1
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, endDay: newEndDay }
                        // Auto-update next season's start date
                        if (idx < newSeasons.length - 1) {
                          const endDate = new Date(2000, season.endMonth - 1, newEndDay)
                          endDate.setDate(endDate.getDate() + 1)
                          newSeasons[idx + 1] = {
                            ...newSeasons[idx + 1],
                            startMonth: endDate.getMonth() + 1,
                            startDay: endDate.getDate()
                          }
                        }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="w-14 p-2 border border-gray-300 rounded text-center"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <NumericInput
                      value={season.percentage}
                      onChange={(e) => {
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, percentage: parseFloat(e.target.value) || 0 }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="w-16 p-2 border border-gray-300 rounded text-right"
                    />
                    <span className="text-gray-500">%</span>
                  </div>
                  <label className="flex items-center gap-1 whitespace-nowrap text-sm">
                    <input
                      type="checkbox"
                      checked={season.weeklyOnly || false}
                      onChange={(e) => {
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, weeklyOnly: e.target.checked }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="w-4 h-4"
                    />
                    Weekly Only
                  </label>
                  <label className="flex items-center gap-1 whitespace-nowrap text-sm">
                    <input
                      type="checkbox"
                      checked={season.closedToGuests || false}
                      onChange={(e) => {
                        const newSeasons = [...settings.seasons]
                        newSeasons[idx] = { ...season, closedToGuests: e.target.checked }
                        saveSettings({ ...settings, seasons: newSeasons })
                      }}
                      className="w-4 h-4"
                    />
                    Closed to Guests
                  </label>
                  <button
                    onClick={() => {
                      if (settings.seasons.length <= 1) return
                      const newSeasons = settings.seasons.filter((_, i) => i !== idx)
                      saveSettings({ ...settings, seasons: newSeasons })
                    }}
                    disabled={settings.seasons.length <= 1}
                    className="ml-auto text-red-500 hover:text-red-700 disabled:text-gray-300 disabled:cursor-not-allowed px-3 py-1 rounded hover:bg-red-50"
                    title={settings.seasons.length <= 1 ? 'Must have at least one season' : 'Remove season'}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {isAddingSeason ? (
            <div className="flex items-center gap-2 p-3 bg-blue-50 rounded border border-blue-200">
              <input
                type="text"
                placeholder="Season Name"
                value={settings.newSeasonName || ''}
                onChange={(e) => {
                  saveSettings({ ...settings, newSeasonName: e.target.value })
                }}
                className="flex-1 min-w-[120px] p-2 border border-gray-300 rounded"
                autoFocus
              />
              <div className="flex items-center gap-1">
                <select
                  value={settings.newSeasonStartMonth || 1}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonStartMonth: parseInt(e.target.value) })
                  }}
                  className="p-2 border border-gray-300 rounded text-sm"
                >
                  {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <NumericInput
                  min={1}
                  max={31}
                  value={settings.newSeasonStartDay || 1}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonStartDay: parseInt(e.target.value) || 1 })
                  }}
                  className="w-14 p-2 border border-gray-300 rounded text-center"
                />
              </div>
              <span className="text-gray-500">to</span>
              <div className="flex items-center gap-1">
                <select
                  value={settings.newSeasonEndMonth || 12}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonEndMonth: parseInt(e.target.value) })
                  }}
                  className="p-2 border border-gray-300 rounded text-sm"
                >
                  {MONTH_NAMES.map((m, i) => <option key={i} value={i+1}>{m}</option>)}
                </select>
                <NumericInput
                  min={1}
                  max={31}
                  value={settings.newSeasonEndDay || 31}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonEndDay: parseInt(e.target.value) || 31 })
                  }}
                  className="w-14 p-2 border border-gray-300 rounded text-center"
                />
              </div>
              <div className="flex items-center gap-1">
                <NumericInput
                  value={settings.newSeasonPercentage || 0}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonPercentage: parseFloat(e.target.value) || 0 })
                  }}
                  className="w-16 p-2 border border-gray-300 rounded text-right"
                />
                <span className="text-gray-500">%</span>
              </div>
              <label className="flex items-center gap-1 whitespace-nowrap text-sm">
                <input
                  type="checkbox"
                  checked={settings.newSeasonWeeklyOnly || false}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonWeeklyOnly: e.target.checked })
                  }}
                  className="w-4 h-4"
                />
                Weekly Only
              </label>
              <label className="flex items-center gap-1 whitespace-nowrap text-sm">
                <input
                  type="checkbox"
                  checked={settings.newSeasonClosedToGuests || false}
                  onChange={(e) => {
                    saveSettings({ ...settings, newSeasonClosedToGuests: e.target.checked })
                  }}
                  className="w-4 h-4"
                />
                Closed to Guests
              </label>
              <button
                onClick={() => {
                  const lastSeason = settings.seasons[settings.seasons.length - 1]
                  const newId = Math.max(...settings.seasons.map(s => s.id)) + 1
                  const newSeason = {
                    id: newId,
                    name: settings.newSeasonName || 'New Season',
                    startMonth: settings.newSeasonStartMonth || (lastSeason ? (lastSeason.endMonth === 12 ? 1 : lastSeason.endMonth) : 1),
                    startDay: settings.newSeasonStartDay || (lastSeason ? (lastSeason.endDay === 31 ? 1 : lastSeason.endDay + 1) : 1),
                    endMonth: settings.newSeasonEndMonth || 12,
                    endDay: settings.newSeasonEndDay || 31,
                    percentage: settings.newSeasonPercentage || 0,
                    weeklyOnly: settings.newSeasonWeeklyOnly || false,
                    closedToGuests: settings.newSeasonClosedToGuests || false
                  }
                  const updatedSettings = { ...settings, seasons: [...settings.seasons, newSeason] }
                  // Clear temporary fields
                  delete updatedSettings.newSeasonName
                  delete updatedSettings.newSeasonStartMonth
                  delete updatedSettings.newSeasonStartDay
                  delete updatedSettings.newSeasonEndMonth
                  delete updatedSettings.newSeasonEndDay
                  delete updatedSettings.newSeasonPercentage
                  delete updatedSettings.newSeasonWeeklyOnly
                  saveSettings(updatedSettings)
                  setIsAddingSeason(false)
                }}
                className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex-shrink-0"
              >
                Save
              </button>
              <button
                onClick={() => {
                  const updatedSettings = { ...settings }
                  delete updatedSettings.newSeasonName
                  delete updatedSettings.newSeasonStartMonth
                  delete updatedSettings.newSeasonStartDay
                  delete updatedSettings.newSeasonEndMonth
                  delete updatedSettings.newSeasonEndDay
                  delete updatedSettings.newSeasonPercentage
                  delete updatedSettings.newSeasonWeeklyOnly
                  saveSettings(updatedSettings)
                  setIsAddingSeason(false)
                }}
                className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex-shrink-0"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                const lastSeason = settings.seasons[settings.seasons.length - 1]
                // Pre-populate the form with smart defaults
                saveSettings({
                  ...settings,
                  newSeasonName: 'New Season',
                  newSeasonStartMonth: lastSeason ? (lastSeason.endMonth === 12 ? 1 : lastSeason.endMonth) : 1,
                  newSeasonStartDay: lastSeason ? (lastSeason.endDay === 31 ? 1 : lastSeason.endDay + 1) : 1,
                  newSeasonEndMonth: 12,
                  newSeasonEndDay: 31,
                  newSeasonPercentage: 0,
                  newSeasonWeeklyOnly: false
                })
                setIsAddingSeason(true)
              }}
              className="py-2 px-4 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
            >
              + Add Season
            </button>
          )}
        </div>

        {/* Nightly Rate Distribution */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-semibold text-gray-700">Nightly Rate Distribution</h3>
            <button
              onClick={() => {
                saveSettings(settings)
                setSectionSaved(prev => ({ ...prev, nightlyWeights: Date.now() }))
                setTimeout(() => setSectionSaved(prev => ({ ...prev, nightlyWeights: null })), 2000)
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                sectionSaved.nightlyWeights
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {sectionSaved.nightlyWeights ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            How should weekly rates be distributed across nights? Higher percentages for weekends encourage short stays to book full weeks.
          </p>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="grid grid-cols-7 gap-2 text-center text-sm">
              {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => (
                <div key={day}>
                  <div className="text-gray-500 capitalize mb-1">{day.slice(0, 3)}</div>
                  <div className="flex items-center justify-center gap-1">
                    <NumericInput
                      min={0}
                      max={100}
                      value={settings.nightlyWeights?.[day] || 0}
                      onChange={(e) => setSettings(s => ({
                        ...s,
                        nightlyWeights: { ...s.nightlyWeights, [day]: parseInt(e.target.value) || 0 }
                      }))}
                      className="w-12 p-1 border border-gray-300 rounded text-center text-sm"
                    />
                    <span className="text-gray-500">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-center">
              <span className={`text-sm font-medium ${
                Object.values(settings.nightlyWeights || {}).reduce((a, b) => a + b, 0) === 100
                  ? 'text-green-600'
                  : 'text-red-600'
              }`}>
                Total: {Object.values(settings.nightlyWeights || {}).reduce((a, b) => a + b, 0)}%
                {Object.values(settings.nightlyWeights || {}).reduce((a, b) => a + b, 0) !== 100 && ' (must equal 100%)'}
              </span>
            </div>
          </div>
        </div>

        {/* Holiday & Custom Anchors */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-start mb-4">
            <h3 className="font-semibold text-gray-700">Holiday & Custom Anchors</h3>
            <button
              onClick={() => {
                saveSettings(settings)
                setSectionSaved(prev => ({ ...prev, anchors: Date.now() }))
                setTimeout(() => setSectionSaved(prev => ({ ...prev, anchors: null })), 2000)
              }}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                sectionSaved.anchors
                  ? 'bg-green-100 text-green-700'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {sectionSaved.anchors ? '✓ Saved' : 'Save'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            These dates ensure pricing aligns year-to-year. Check/uncheck holidays or add custom dates for local events.
          </p>

          <div className="mb-4 space-y-2">
            {(settings.anchors || []).map(anchor => (
              <label
                key={anchor.id}
                className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                  anchor.enabled ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                } ${anchor.type === 'custom' ? 'bg-purple-50 border-purple-300' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={anchor.enabled}
                  onChange={(e) => {
                    setSettings(s => ({
                      ...s,
                      anchors: s.anchors.map(a =>
                        a.id === anchor.id ? { ...a, enabled: e.target.checked } : a
                      )
                    }))
                  }}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <div className="flex-1">
                  <div className="font-medium text-gray-800">
                    {anchor.name}
                    {anchor.type === 'custom' && <span className="ml-1 text-xs text-purple-600">(custom)</span>}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(anchor.sourceDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} → {new Date(anchor.targetDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
                {anchor.type === 'custom' && (
                  <button
                    onClick={(e) => {
                      e.preventDefault()
                      setSettings(s => ({
                        ...s,
                        anchors: s.anchors.filter(a => a.id !== anchor.id)
                      }))
                    }}
                    className="text-red-500 hover:text-red-700 px-3 py-1 rounded hover:bg-red-50"
                  >
                    Remove
                  </button>
                )}
              </label>
            ))}
          </div>

          {isAddingAnchor ? (
            <div className="flex items-end gap-2 p-3 bg-blue-50 rounded border border-blue-200">
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  value={newAnchorLabel}
                  onChange={(e) => setNewAnchorLabel(e.target.value)}
                  placeholder="e.g., April School Break"
                  className="w-full p-2 border border-gray-300 rounded"
                  autoFocus
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">2026 Date</label>
                <input
                  type="date"
                  value={newAnchorSourceDate}
                  onChange={(e) => setNewAnchorSourceDate(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">2027 Date</label>
                <input
                  type="date"
                  value={newAnchorTargetDate}
                  onChange={(e) => setNewAnchorTargetDate(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded"
                />
              </div>
              <button
                onClick={() => {
                  if (newAnchorLabel && newAnchorSourceDate && newAnchorTargetDate) {
                    const newAnchor = {
                      id: `custom_${Date.now()}`,
                      name: newAnchorLabel,
                      type: 'custom',
                      enabled: true,
                      sourceDate: newAnchorSourceDate,
                      targetDate: newAnchorTargetDate
                    }
                    setSettings(s => ({
                      ...s,
                      anchors: [...(s.anchors || []), newAnchor]
                    }))
                    setNewAnchorLabel('')
                    setNewAnchorSourceDate('')
                    setNewAnchorTargetDate('')
                    setIsAddingAnchor(false)
                  }
                }}
                disabled={!newAnchorLabel || !newAnchorSourceDate || !newAnchorTargetDate}
                className="py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex-shrink-0"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setNewAnchorLabel('')
                  setNewAnchorSourceDate('')
                  setNewAnchorTargetDate('')
                  setNewAnchorWeeklyOnly(false)
                  setIsAddingAnchor(false)
                }}
                className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 flex-shrink-0"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAddingAnchor(true)}
              className="py-2 px-4 border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50"
            >
              + Add Custom Anchor
            </button>
          )}
        </div>

        {/* Data Management */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="font-semibold text-gray-700 mb-4">Data Management</h3>

          <div className="space-y-4">
            {/* Export */}
            <div className="flex items-start gap-4">
              <button
                onClick={async () => {
                  const response = await fetch('/api/settings/export')
                  const data = await response.json()
                  if (data.success) {
                    const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'str-pricing-backup.json'
                    a.click()
                  }
                }}
                className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Export Settings
              </button>
              <div className="text-sm text-gray-500">
                Download your settings as a backup file. Use "Import Settings" to restore on this or another device.
              </div>
            </div>

            {/* Import */}
            <div className="flex items-start gap-4">
              <label className="py-2 px-4 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 cursor-pointer">
                Import Settings
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      const text = await file.text()
                      const data = JSON.parse(text)
                      const response = await fetch('/api/settings/import', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ data })
                      })
                      const result = await response.json()
                      if (result.success) {
                        loadSettings()
                        alert('Settings imported successfully!')
                      }
                    } catch (err) {
                      alert('Failed to import settings: ' + err.message)
                    }
                  }}
                />
              </label>
              <div className="text-sm text-gray-500">
                Restore settings from a previously exported backup file.
              </div>
            </div>

            {/* Reset */}
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  if (window.confirm('This will delete ALL your settings and calendar data and restart the setup wizard. Are you sure?')) {
                    fetch('/api/settings', { method: 'DELETE' }).then(() => {
                      setSettings(null)
                      setMonths([])
                      setIsLoggedIn(false)
                      setScrapeState('idle')
                      setAppState('setup')
                      setSetupStep(1)
                    })
                  }
                }}
                className="py-2 px-4 border border-red-300 text-red-700 rounded-lg hover:bg-red-50"
              >
                Reset All Settings & Start Setup Wizard
              </button>
              <p className="mt-2 text-sm text-red-600">
                Warning: This will erase all your configuration and start fresh.
              </p>
            </div>
          </div>
        </div>

        {/* Done Button */}
        <div className="flex justify-end">
          <button
            onClick={() => setActiveTab('import')}
            className="py-2 px-6 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  function renderMissingDataModal() {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
                <span className="text-yellow-600 text-xl">!</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-800">Missing Pricing Data</h3>
            </div>

            <p className="text-gray-600 mb-4">
              {missingWeeksForModal.length} week{missingWeeksForModal.length > 1 ? 's are' : ' is'} missing pricing data:
            </p>

            <div className="max-h-48 overflow-y-auto mb-4 border border-gray-200 rounded-lg">
              <ul className="divide-y divide-gray-200">
                {missingWeeksForModal.map((week, idx) => (
                  <li key={idx} className="px-3 py-2 text-sm text-gray-700 bg-yellow-50">
                    {week}
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              You can apply anyway with incomplete data, or go back to enter the missing prices.
            </p>
          </div>

          <div className="bg-gray-50 px-6 py-4 flex justify-between">
            <button
              onClick={() => {
                setShowMissingDataModal(false)
                setMissingWeeksForModal([])
                // Navigate to Import tab where prices can be entered
                setActiveTab('import')
                // Scroll to the first missing week row after navigation
                setTimeout(() => {
                  const missingRow = document.querySelector('[data-missing-price="true"]')
                  if (missingRow) {
                    missingRow.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    missingRow.classList.add('ring-2', 'ring-red-500')
                    setTimeout(() => missingRow.classList.remove('ring-2', 'ring-red-500'), 3000)
                  }
                }, 200)
              }}
              className="py-2 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700"
            >
              Go Back & Enter Prices
            </button>
            <button
              onClick={() => {
                setShowMissingDataModal(false)
                setMissingWeeksForModal([])

                if (missingDataModalContext === 'planning') {
                  // Navigating from Import to Planning - just go to planning
                  setActiveTab('planning')
                } else {
                  // Navigating from Planning to Platforms - apply year planning
                  const allWeeks = months.flatMap(month => month.weeks)
                  const sourceWeeks = allWeeks.filter(week => week.startDate?.year === sourceYear)
                  const weekStart = settings?.weekStartDay ?? 6
                  const mappings = mapWeeksByHolidays(sourceWeeks, sourceYear, targetYear, settings?.anchors || [], weekStart)
                  const rows = mappings.map(mapping => {
                    const srcPrice = parsePrice(mapping.source?.price || mapping.proposedPrice)
                    const targetStartDate = mapping.target?.start
                    const season = targetStartDate ? getSeasonForDate(targetStartDate) : null
                    const percentage = season?.percentage || 0
                    const proposedPrice = calculateAdjustedPrice(srcPrice, percentage)
                    return { ...mapping, sourcePrice: srcPrice, season, percentage, proposedPrice, netChange: proposedPrice - srcPrice }
                  })
                  applyYearPlanning(rows)
                }
              }}
              className="py-2 px-4 rounded-lg bg-yellow-500 text-white font-medium hover:bg-yellow-600"
            >
              {missingDataModalContext === 'planning' ? 'Continue Anyway' : 'Apply Anyway'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ============ MAIN RENDER ============

  if (!settingsLoaded) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  if (appState === 'setup') {
    return renderSetupWizard()
  }

  return renderMainApp()
}

export default App
