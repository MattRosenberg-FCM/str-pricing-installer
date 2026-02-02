# STR Pricing Updater - Electron Installer Project

## PROJECT OVERVIEW

This is the **packaging and distribution project** for the STR Pricing Updater.

**Source application**: `/Users/mattrosenberg/Documents/wnav-pricing-tool`
**Installer project**: `/Users/mattrosenberg/Documents/str-pricing-installer`

This project wraps the React + Express app in Electron and creates standalone installers for Mac (.dmg) and Windows (.exe).

## RELATIONSHIP TO SOURCE PROJECT

- The source application (`wnav-pricing-tool`) is the development environment
- This installer project (`str-pricing-installer`) is for packaging and distribution
- Source files are copied from `wnav-pricing-tool` to this project
- When making feature changes, work in `wnav-pricing-tool` first, then copy updates here

## TECH STACK

- **Electron**: Desktop app framework
- **electron-builder**: Creates Mac and Windows installers
- **Vite**: Frontend build tool (from source project)
- **Express**: Backend API server (from source project)
- **Playwright**: Web scraping with bundled Chromium browser
- **GitHub Actions**: Automated builds for both platforms

## PROJECT STRUCTURE

```
str-pricing-installer/
├── package.json              # Electron + electron-builder config
├── electron/
│   └── main.js               # Electron main process
├── src/                      # React frontend (copied from source)
├── server/                   # Express backend (copied from source)
├── scripts/                  # Build scripts (copied from source)
├── build/
│   ├── entitlements.mac.plist  # Mac code signing entitlements
│   ├── icon.icns             # Mac app icon (TODO)
│   └── icon.ico              # Windows app icon (TODO)
├── .github/workflows/
│   └── build.yml             # GitHub Actions CI/CD
├── release/                  # Output directory for installers
├── README.md                 # End-user installation instructions
└── CLAUDE.md                 # This file - project instructions
```

## KEY IMPLEMENTATION DETAILS

### Data Directory Management

The app uses different data directories depending on environment:

- **Development**: `./data` in project root (same as source project)
- **Production**: OS-specific app data directory
  - Mac: `~/Library/Application Support/str-pricing-updater/`
  - Windows: `%APPDATA%\str-pricing-updater\`

This is handled automatically in `electron/main.js` via `getDataDirectory()`.

### Playwright Browser Bundling

Playwright requires Chromium to be bundled with the app:

1. `package.json` includes `extraResources` config to copy Chromium
2. `electron/main.js` sets `PLAYWRIGHT_BROWSERS_PATH` environment variable
3. Server uses this path to find bundled browser in production

### Server Startup

The Electron main process:
1. Starts the Express server as a child process
2. Waits for server health check (`/api/health`) to succeed
3. Creates the browser window once server is ready
4. Kills server process when app quits

### Development vs Production

**Development** (`npm run electron:dev`):
- Loads frontend from Vite dev server (http://localhost:5173)
- Opens DevTools automatically
- Uses local `./data` directory
- Hot module reloading works

**Production** (after building):
- Loads frontend from `dist/` directory
- No DevTools
- Uses OS app data directory
- Fully self-contained

## BUILD PROCESS

### Local Build

```bash
# Install dependencies (first time only)
npm install

# Install Playwright browsers (first time only)
npx playwright install chromium

# Build for current platform
npm run electron:build

# Build for specific platform
npm run electron:build:mac    # Creates .dmg
npm run electron:build:win    # Creates .exe
```

Installers are created in `release/` directory.

### GitHub Actions Build

Builds are triggered automatically when you push a git tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow:
1. Builds Mac installer on macOS runner
2. Builds Windows installer on Windows runner
3. Uploads artifacts to workflow
4. If tag push, creates GitHub release with installers attached

## DEVELOPMENT WORKFLOW

### Testing Electron Packaging Locally

```bash
# Start development mode (recommended for testing)
npm run electron:dev

# Or build and run production build
npm run electron:build
open release/mac/STR\ Pricing\ Updater.app  # Mac
# or double-click .exe in release/win-unpacked/  # Windows
```

### Making Changes

1. **For feature work**: Make changes in `wnav-pricing-tool` first
2. **Test in source project**: Run `npm run dev` + `npm run server` there
3. **Copy updates**: Copy modified files to this installer project
4. **Test Electron build**: Run `npm run electron:dev` here
5. **Build installer**: Run `npm run electron:build` to verify packaging

### Updating Source Files

When source project changes:

```bash
# From installer project root
cp -r /path/to/wnav-pricing-tool/src ./src
cp -r /path/to/wnav-pricing-tool/server ./server
# Copy any other changed files
```

## IMPORTANT CONFIGURATION

### package.json Build Config

Key electron-builder settings:

```json
"build": {
  "files": ["dist/**/*", "electron/**/*", "server/**/*", "node_modules/**/*"],
  "extraResources": [{
    "from": "node_modules/playwright-core/.local-browsers",
    "to": "playwright-browsers"
  }],
  "mac": {
    "target": { "target": "dmg", "arch": ["x64", "arm64"] },
    "hardenedRuntime": true,
    "entitlements": "build/entitlements.mac.plist"
  },
  "win": {
    "target": [{ "target": "nsis", "arch": ["x64"] }]
  }
}
```

### Mac Code Signing

For distribution outside the Mac App Store, you need:
1. Apple Developer account ($99/year)
2. Developer ID Application certificate
3. Set environment variables for signing:
   ```bash
   export CSC_LINK=/path/to/certificate.p12
   export CSC_KEY_PASSWORD=your_password
   ```

Without signing, users will see security warnings on first launch.

### Windows Code Signing

For trusted Windows installation:
1. Purchase code signing certificate
2. Set environment variables:
   ```bash
   export CSC_LINK=/path/to/certificate.pfx
   export CSC_KEY_PASSWORD=your_password
   ```

Without signing, Windows SmartScreen will show warnings.

## APP ICONS

TODO: Create app icons and place in `build/` directory:

- **Mac**: `icon.icns` (1024x1024 PNG → icns)
- **Windows**: `icon.ico` (256x256 PNG → ico)

Use tools like:
- Mac: `iconutil` (built-in)
- Windows: Online converter or ImageMagick

## TESTING CHECKLIST

Before releasing:

- [ ] App launches successfully on Mac
- [ ] App launches successfully on Windows
- [ ] WNAV login and scraping works
- [ ] Manual entry works
- [ ] Year-over-year planning works
- [ ] Platform pricing calculations correct
- [ ] Excel export works
- [ ] Data persists between app restarts
- [ ] App updates work (if using auto-updater)

## KNOWN ISSUES

### Mac Security Warnings

On first launch, Mac users will see "STR Pricing Updater is an app downloaded from the Internet. Are you sure you want to open it?"

**Without code signing**: User must right-click → Open or go to System Preferences → Security & Privacy

**With code signing**: Standard macOS security prompt

### Windows SmartScreen

Without code signing, Windows SmartScreen shows "Windows protected your PC" warning.

User must click "More info" → "Run anyway"

### Playwright Browser Size

The bundled Chromium browser adds ~300MB to the installer size. This is necessary for WNAV scraping functionality.

## DISTRIBUTION

### GitHub Releases (Recommended)

1. Tag version: `git tag v1.0.0`
2. Push tag: `git push origin v1.0.0`
3. GitHub Actions builds installers automatically
4. Download from Releases page

### Direct Distribution

Host `.dmg` and `.exe` files on your own website or cloud storage.

Provide download links in format:
```
https://yoursite.com/downloads/STR-Pricing-Updater-1.0.0.dmg
https://yoursite.com/downloads/STR-Pricing-Updater-Setup-1.0.0.exe
```

## VERSIONING

Version numbers should match the source project (`wnav-pricing-tool`).

When releasing:
1. Update version in `package.json`
2. Update version in `README.md`
3. Create git tag: `git tag v1.0.0`
4. Push tag to trigger build: `git push origin v1.0.0`

## AUTO-UPDATES (FUTURE)

electron-builder supports auto-updates via:
- **Mac**: Squirrel.Mac or Sparkle
- **Windows**: NSIS installer with built-in updater

Requires:
1. Update server hosting release metadata
2. Code signing (required for silent updates)
3. Configuration in `package.json`

This is NOT currently implemented.

## TROUBLESHOOTING

### Build Fails with Playwright Error

Ensure Playwright browsers are installed:
```bash
npx playwright install chromium
```

### App Won't Launch

Check for errors:
- **Mac**: Open Console app and filter for "STR Pricing"
- **Windows**: Check Event Viewer

### Server Doesn't Start

The app waits 30 seconds for server health check. If it fails:
1. Check port 3001 is not in use
2. Check server logs in Electron console

### Data Not Persisting

Check data directory exists and is writable:
- **Mac**: `~/Library/Application Support/str-pricing-updater/`
- **Windows**: `%APPDATA%\str-pricing-updater\`

## REMINDERS FOR CLAUDE CODE

1. **This is the installer project**, not the source application
2. **Feature work happens in wnav-pricing-tool first**, then copy here
3. **Test locally before pushing** - build installers and verify they work
4. **Version numbers should match** between source and installer projects
5. **Icons are required** for production release (currently TODO)
6. **Code signing is optional** but recommended for user trust
7. **GitHub Actions builds both platforms** - test locally first
8. **Data directory differs** between dev and production
9. **Playwright bundling is critical** - don't break extraResources config
10. **Server must start before window** - don't modify startup sequence
