# Installation Guide for Developers

This guide is for developers who want to build the installers locally or set up the CI/CD pipeline.

## Prerequisites

- Node.js 20 or later
- Git
- For Mac builds: macOS with Xcode Command Line Tools
- For Windows builds: Windows with Visual Studio Build Tools

## Initial Setup

1. **Clone or navigate to the repository:**
   ```bash
   cd /Users/mattrosenberg/Documents/str-pricing-installer
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Install Playwright browsers:**
   ```bash
   npx playwright install chromium
   ```

## Development Mode

Run the app in development mode with hot reloading:

```bash
npm run electron:dev
```

This will:
- Start Vite dev server on port 5173
- Start Electron with DevTools open
- Enable hot module reloading
- Use local `./data` directory

## Building Installers

### Build for Current Platform

```bash
npm run electron:build
```

This creates an installer for your current operating system in `release/`.

### Build for Specific Platform

**Mac:**
```bash
npm run electron:build:mac
```

Creates:
- `release/STR Pricing Updater-1.0.0.dmg`
- `release/STR Pricing Updater-1.0.0-arm64.dmg` (Apple Silicon)
- `release/mac/` (unpacked app for testing)

**Windows:**
```bash
npm run electron:build:win
```

Creates:
- `release/STR Pricing Updater Setup 1.0.0.exe`
- `release/win-unpacked/` (unpacked app for testing)

## Testing the Built App

### Mac

```bash
open "release/mac/STR Pricing Updater.app"
```

Or double-click the `.dmg` file and drag to Applications.

### Windows

Double-click `release/win-unpacked/STR Pricing Updater.exe`

Or run the `.exe` installer.

## Code Signing (Optional but Recommended)

### Mac

1. **Get Developer ID certificate:**
   - Enroll in Apple Developer Program ($99/year)
   - Create Developer ID Application certificate in Xcode

2. **Export certificate:**
   - Open Keychain Access
   - Export certificate as `.p12` file with password

3. **Set environment variables:**
   ```bash
   export CSC_LINK=/path/to/certificate.p12
   export CSC_KEY_PASSWORD=your_password
   ```

4. **Build with signing:**
   ```bash
   npm run electron:build:mac
   ```

### Windows

1. **Purchase code signing certificate** from providers like:
   - DigiCert
   - Sectigo
   - GlobalSign

2. **Export as `.pfx` file** with password

3. **Set environment variables:**
   ```bash
   export CSC_LINK=/path/to/certificate.pfx
   export CSC_KEY_PASSWORD=your_password
   ```

4. **Build with signing:**
   ```bash
   npm run electron:build:win
   ```

## GitHub Actions Setup

The repository includes GitHub Actions workflows for automated builds.

### Setup Steps

1. **Push code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/str-pricing-installer.git
   git push -u origin main
   ```

2. **Add code signing secrets (optional):**

   Go to repository Settings > Secrets and variables > Actions

   Add secrets:
   - `CSC_LINK` (base64-encoded certificate)
   - `CSC_KEY_PASSWORD`

   To encode certificate:
   ```bash
   base64 -i certificate.p12 | pbcopy  # Mac
   certutil -encode certificate.p12 tmp.b64 && type tmp.b64 | clip  # Windows
   ```

3. **Trigger build:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

This will:
- Build Mac installer on macOS runner
- Build Windows installer on Windows runner
- Upload artifacts to workflow run
- Create GitHub release with installers attached (if tag push)

## Manual Release Process

1. **Update version:**
   ```bash
   # Edit package.json, change version to 1.0.1
   git commit -am "Bump version to 1.0.1"
   ```

2. **Create tag:**
   ```bash
   git tag v1.0.1
   git push origin main
   git push origin v1.0.1
   ```

3. **Wait for GitHub Actions:**
   - Check Actions tab for build progress
   - Download artifacts from workflow run
   - Or installers are automatically added to release

4. **Test installers:**
   - Download Mac and Windows installers
   - Test on clean machines
   - Verify all features work

5. **Publish release:**
   - Edit draft release on GitHub
   - Add release notes
   - Publish release

## Troubleshooting

### Build Fails: "Cannot find module 'playwright-core'"

```bash
npm install
npx playwright install chromium
```

### Build Fails: "No code signing identity found"

Either:
- Disable code signing: Remove `hardenedRuntime` and `entitlements` from `package.json`
- Or set up code signing (see above)

### Electron Window Shows Blank Screen

Check console for errors:
- Press Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows)
- Look for network errors or missing files

### Server Not Starting

Check port 3001 is available:
```bash
lsof -i :3001  # Mac/Linux
netstat -ano | findstr :3001  # Windows
```

### Playwright Browser Not Found

Ensure `PLAYWRIGHT_BROWSERS_PATH` is set correctly in `electron/main.js`.

In production, it should point to:
```
process.resourcesPath/playwright-browsers
```

## File Size Optimization

The bundled Chromium browser adds ~300MB to installer size. This is necessary for WNAV scraping.

To reduce size:
- Remove unused Playwright browsers (we only need chromium)
- Enable compression in electron-builder config
- Consider lazy loading Playwright on first use

Current installer sizes (approximate):
- Mac DMG: ~350MB
- Windows EXE: ~380MB

## Next Steps

- [ ] Create app icons (see `build/ICONS-TODO.md`)
- [ ] Set up code signing for trusted installation
- [ ] Configure auto-updates (optional)
- [ ] Add crash reporting (optional)
- [ ] Set up notarization for macOS (required for Catalina+)
