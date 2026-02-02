# Quick Start Guide

Get the STR Pricing Updater installer project up and running in 5 minutes.

## 1. Install Dependencies

```bash
cd /Users/mattrosenberg/Documents/str-pricing-installer
npm install
```

This installs all Node.js packages including Electron, electron-builder, and all dependencies.

## 2. Install Playwright Browser

```bash
npx playwright install chromium
```

This downloads the Chromium browser needed for WNAV scraping (~300MB).

## 3. Run in Development Mode

```bash
npm run electron:dev
```

This will:
- Start the Vite dev server
- Launch Electron with DevTools open
- Open the app in development mode

You should see the STR Pricing Updater window open.

## 4. Test the App

Try these workflows:
- Click "Login to WeNeedAVacation.com" (will open browser for login)
- Or click "Enter Manually" to test without WNAV
- Walk through the setup wizard
- Test entering pricing data
- Test year-over-year planning

All data is stored in `./data/` directory during development.

## 5. Build an Installer

```bash
npm run electron:build
```

This creates an installer for your current platform in the `release/` directory:
- **Mac**: `release/*.dmg` and `release/mac/STR Pricing Updater.app`
- **Windows**: `release/*.exe` and `release/win-unpacked/`

## 6. Test the Built App

**Mac:**
```bash
open "release/mac/STR Pricing Updater.app"
```

**Windows:**
Double-click `release/win-unpacked/STR Pricing Updater.exe`

In production mode, data is stored in:
- **Mac**: `~/Library/Application Support/str-pricing-updater/`
- **Windows**: `%APPDATA%\str-pricing-updater\`

## Common Commands

```bash
# Development mode with hot reload
npm run electron:dev

# Build for current platform
npm run electron:build

# Build Mac installer only
npm run electron:build:mac

# Build Windows installer only
npm run electron:build:win

# Run tests (from source project)
npm test

# Clean build artifacts
rm -rf release/ dist/
```

## Troubleshooting

**Port 3001 already in use:**
```bash
# Mac
lsof -ti:3001 | xargs kill -9

# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F
```

**Playwright not found:**
```bash
npx playwright install chromium
```

**Build fails:**
```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
```

**White screen in Electron:**
- Open DevTools: Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows)
- Check console for errors
- Verify server started (check terminal output)

## Next Steps

1. **Create app icons** - See `build/ICONS-TODO.md`
2. **Set up code signing** - See `INSTALLATION-GUIDE.md`
3. **Push to GitHub** - Enable automated builds
4. **Test on clean machines** - Verify fresh installs work

## Need Help?

- **Full documentation**: See `CLAUDE.md`
- **Installation guide**: See `INSTALLATION-GUIDE.md`
- **Pre-release checklist**: See `CHECKLIST.md`
- **Source project**: `/Users/mattrosenberg/Documents/wnav-pricing-tool`

## Project Structure Overview

```
str-pricing-installer/
├── electron/main.js          # Electron entry point
├── src/                      # React frontend
├── server/                   # Express backend
├── package.json              # Dependencies & build config
├── .github/workflows/        # GitHub Actions CI/CD
├── build/                    # Icons & signing files
└── release/                  # Built installers (created on build)
```

That's it! You're ready to develop and build installers.
