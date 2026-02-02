# Version and Build Management

This directory contains scripts for managing semantic versioning and build tracking.

## Quick Reference

### Bump Version
```bash
# Patch version (1.0.0 → 1.0.1) - Bug fixes
npm run version:patch

# Minor version (1.0.0 → 1.1.0) - New features
npm run version:minor

# Major version (1.0.0 → 2.0.0) - Breaking changes
npm run version:major
```

### Build with Auto-Incrementing Build Number
```bash
# Automatically runs prebuild to generate build info
npm run build
```

### Create a Release
```bash
# Bumps patch version, builds, and creates git tag
npm run release
```

After running any version command, push your changes:
```bash
git push origin main
git push origin v1.0.1  # (use the new version number)
```

## What Each Script Does

### `build-info.js`
Generates `src/build-info.json` with build metadata.

Runs automatically before every build (via `prebuild` script).

**Generated data:**
- `version` - Current version from package.json
- `buildNumber` - Auto-incremented build counter
- `buildDate` - ISO timestamp of build
- `gitCommit` - Full commit hash
- `gitCommitShort` - Short commit hash
- `gitBranch` - Current git branch
- `isDirty` - Whether working directory has uncommitted changes

**Usage:**
```bash
node scripts/build-info.js
```

### `version.js`
Manages semantic versioning with automated changelog and git tagging.

**What it does:**
1. Bumps version in package.json
2. Gathers commit messages since last tag
3. Updates CHANGELOG.md with new entry
4. Stages package.json and CHANGELOG.md
5. Creates a commit with version bump
6. Creates annotated git tag

**Usage:**
```bash
node scripts/version.js [patch|minor|major]
```

**Example:**
```bash
node scripts/version.js patch
# Output:
# 🚀 Starting patch version bump...
# Bumping version: 1.0.0 → 1.0.1
# Updated package.json to version 1.0.1
# Updated CHANGELOG.md with version 1.0.1
# Staged package.json and CHANGELOG.md
# Created commit for version 1.0.1
# Created git tag: v1.0.1
# ✅ Version bump complete!
```

## Using Version Info in the App

Import build info in any React component:

```javascript
import buildInfo from './buildInfo.js';

function Footer() {
  return (
    <div>
      <p>Version {buildInfo.fullVersion}</p>
      <p>Built on {buildInfo.formattedBuildDate}</p>
      <p>Commit {buildInfo.gitCommitShort}</p>
    </div>
  );
}
```

Available properties:
- `buildInfo.version` - "1.0.0"
- `buildInfo.buildNumber` - 42
- `buildInfo.fullVersion` - "1.0.0 (build 42)"
- `buildInfo.buildDate` - "2026-01-31T12:00:00.000Z"
- `buildInfo.formattedBuildDate` - "1/31/2026, 12:00:00 PM"
- `buildInfo.gitCommit` - Full hash
- `buildInfo.gitCommitShort` - Short hash
- `buildInfo.gitBranch` - "main"
- `buildInfo.isDirty` - true/false

## Semantic Versioning Rules

We follow [semver.org](https://semver.org/) strictly:

**MAJOR** version (1.0.0 → 2.0.0):
- Breaking changes
- Incompatible API changes
- Major feature rewrites

**MINOR** version (1.0.0 → 1.1.0):
- New features
- New functionality
- Backwards-compatible additions

**PATCH** version (1.0.0 → 1.0.1):
- Bug fixes
- Security patches
- Minor improvements
- Backwards-compatible fixes

## Workflow for Releases

1. **Make your changes** - Develop features or fix bugs
2. **Commit your work** - Regular git commits
3. **Bump version** - Use appropriate version bump script
4. **Push to remote** - Push both commits and tags
5. **Build for distribution** - Run build for Electron packaging

Example workflow:
```bash
# After completing feature work
git add .
git commit -m "Add export to PDF feature"

# Bump minor version (new feature)
npm run version:minor

# Push commits and tags
git push origin main
git push origin v1.1.0

# Build for distribution
npm run build
```

## CHANGELOG.md

Automatically maintained by version.js. Each version bump:
- Creates new section with version and date
- Lists all commits since last tag
- Formats with markdown

Manual edits are preserved (script only prepends new entries).

## Files Generated

**Committed to git:**
- `CHANGELOG.md` - Version history
- `package.json` - Updated version field

**Committed on release builds:**
- `src/build-info.json` - Build metadata (included in dist)

**Build artifacts (not committed):**
- `dist/` - Vite build output

## Cross-Platform Compatibility

All scripts use Node.js native modules and work on:
- macOS (tested)
- Windows (compatible)
- Linux (compatible)

Git commands gracefully handle missing git repository.

## Troubleshooting

**"Git command failed"**
- Ensure you're in a git repository
- Check git is installed: `git --version`
- Scripts will use "unknown" as fallback

**"Invalid version format"**
- package.json version must be X.Y.Z format
- No prefixes, no suffixes

**Build number not incrementing**
- Check src/build-info.json exists and is valid JSON
- Delete file to reset to build #1

## Future: Electron Packaging

When packaging with Electron, the version from package.json will be used for:
- App version in About dialog
- Installer version number
- Update channel version checks

Build number will track internal builds separately from public versions.
