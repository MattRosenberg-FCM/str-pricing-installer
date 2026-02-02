# STR Pricing Updater

A desktop application for vacation rental owners to manage and optimize pricing across multiple platforms.

## Installation

### Mac

1. Download the `.dmg` file from the latest release
2. Open the downloaded `.dmg` file
3. Drag the **STR Pricing Updater** icon to the **Applications** folder
4. Open the **Applications** folder and double-click **STR Pricing Updater**
5. If you see a security warning, go to **System Preferences > Security & Privacy** and click **Open Anyway**

### Windows

1. Download the `.exe` installer from the latest release
2. Double-click the downloaded `.exe` file
3. Follow the installation wizard:
   - Click **Next**
   - Choose installation location (or use default)
   - Click **Install**
   - Click **Finish**
4. Launch **STR Pricing Updater** from your Start Menu or Desktop shortcut

## First-Time Setup

When you first open the app, you'll be guided through a setup wizard that will help you:

1. Connect to your WeNeedAVacation.com account (or set up manual entry)
2. Configure your platform settings (Airbnb, Vrbo, etc.)
3. Set your nightly rate distribution preferences
4. Define holiday anchors for year-over-year pricing
5. Create seasonal pricing rules

All your data is stored locally on your computer. Nothing is sent to the cloud.

## Features

- **Import Pricing**: Automatically import your current pricing from WeNeedAVacation.com
- **Year-Over-Year Planning**: Duplicate pricing patterns using holiday anchors
- **Bulk Adjustments**: Apply percentage changes by season
- **Platform Pricing**: Calculate commission-adjusted prices for Airbnb, Vrbo, and other platforms
- **Nightly Breakdown**: Convert weekly rates to nightly rates with customizable distribution
- **Entry Guide**: Step-by-step guide for manually updating prices on each platform
- **Export**: Save your pricing to Excel or CSV files

## Data Storage

Your data is stored locally in:
- **Mac**: `~/Library/Application Support/str-pricing-updater/`
- **Windows**: `%APPDATA%\str-pricing-updater\`

To completely reset the app, delete this directory while the app is closed.

## Support

For issues or questions, please visit: [GitHub Issues](https://github.com/YOUR_USERNAME/str-pricing-installer/issues)

## System Requirements

- **Mac**: macOS 10.13 or later (Intel or Apple Silicon)
- **Windows**: Windows 10 or later (64-bit)
- **Internet**: Required for WeNeedAVacation.com import feature only

## Privacy

This application:
- Runs entirely on your local computer
- Does NOT send your data to any cloud service
- Does NOT collect analytics or telemetry
- Only connects to the internet to import pricing from WeNeedAVacation.com when you explicitly request it

## Version

Current version: 1.0.0

See [CHANGELOG.md](CHANGELOG.md) for release notes.
