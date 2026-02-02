# Pre-Release Checklist

## Initial Setup
- [x] Project structure created
- [x] package.json configured with electron-builder
- [x] Electron main process created
- [x] Source files copied from wnav-pricing-tool
- [x] GitHub Actions workflow configured
- [x] Documentation created

## Before First Build
- [ ] App icons created (see `build/ICONS-TODO.md`)
  - [ ] icon.icns (Mac)
  - [ ] icon.ico (Windows)
- [ ] Test local build: `npm run electron:build`
- [ ] Test unpacked app works on Mac
- [ ] Test unpacked app works on Windows
- [ ] Verify data persistence between app restarts

## Code Signing (Recommended)
- [ ] Mac: Obtain Apple Developer ID certificate
- [ ] Mac: Export certificate as .p12 file
- [ ] Windows: Purchase code signing certificate
- [ ] Windows: Export certificate as .pfx file
- [ ] Add CSC_LINK and CSC_KEY_PASSWORD to GitHub Secrets
- [ ] Test signed build locally

## GitHub Release
- [ ] Push code to GitHub repository
- [ ] Create git tag: `git tag v1.0.0`
- [ ] Push tag: `git push origin v1.0.0`
- [ ] Monitor GitHub Actions workflow
- [ ] Download and test Mac installer
- [ ] Download and test Windows installer
- [ ] Verify installers attached to GitHub release

## Testing Checklist
- [ ] Fresh install on Mac works
- [ ] Fresh install on Windows works
- [ ] WNAV login and authentication works
- [ ] Calendar scraping imports data correctly
- [ ] Manual entry mode works
- [ ] Year-over-year planning completes
- [ ] Platform pricing calculations are correct
- [ ] Excel export creates valid file
- [ ] CSV export creates valid file
- [ ] Settings persist after app restart
- [ ] Data persists after app restart
- [ ] App can be uninstalled cleanly

## Distribution
- [ ] Create download page with clear instructions
- [ ] Test download links work
- [ ] Add installation instructions for Mac security warnings
- [ ] Add installation instructions for Windows SmartScreen
- [ ] Create support/feedback channel
- [ ] Set up update mechanism (optional)

## Documentation
- [ ] README.md has accurate installation steps
- [ ] CHANGELOG.md created with version history
- [ ] System requirements documented
- [ ] Privacy policy added (no data collection)
- [ ] License file added

## Future Enhancements
- [ ] Auto-update mechanism
- [ ] Crash reporting
- [ ] Usage analytics (with opt-in)
- [ ] Multi-language support
- [ ] Licensing/activation system
- [ ] In-app purchase for premium features

## Notes

**Current Status**: Initial project setup complete. Ready for icon creation and first build.

**Blockers**:
1. App icons required for production-quality build
2. Code signing recommended but optional for testing

**Next Immediate Steps**:
1. Create app icons
2. Test local build
3. Push to GitHub
4. Test automated builds
