#!/usr/bin/env node

/**
 * Version Management Script
 * Bumps version, creates git tags, updates CHANGELOG
 * Usage: node scripts/version.js [patch|minor|major]
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Parse version string
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version format: ${version}`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10)
  };
}

// Bump version based on type
function bumpVersion(currentVersion, type) {
  const parts = parseVersion(currentVersion);

  switch (type) {
    case 'major':
      parts.major += 1;
      parts.minor = 0;
      parts.patch = 0;
      break;
    case 'minor':
      parts.minor += 1;
      parts.patch = 0;
      break;
    case 'patch':
      parts.patch += 1;
      break;
    default:
      throw new Error(`Invalid bump type: ${type}. Use patch, minor, or major.`);
  }

  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

// Execute command safely
function exec(command, silent = false) {
  try {
    const output = execSync(command, { cwd: rootDir, encoding: 'utf8' });
    if (!silent) {
      console.log(output.trim());
    }
    return output.trim();
  } catch (error) {
    throw new Error(`Command failed: ${command}\n${error.message}`);
  }
}

// Update package.json version
function updatePackageJson(newVersion) {
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  packageJson.version = newVersion;
  writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8');
  console.log(`Updated package.json to version ${newVersion}`);
}

// Get commit log since last tag
function getCommitsSinceLastTag() {
  try {
    const lastTag = exec('git describe --tags --abbrev=0', true);
    return exec(`git log ${lastTag}..HEAD --oneline --no-decorate`, true);
  } catch (error) {
    // No previous tags, get all commits
    return exec('git log --oneline --no-decorate', true);
  }
}

// Update CHANGELOG.md
function updateChangelog(newVersion, commits) {
  const changelogPath = join(rootDir, 'CHANGELOG.md');
  const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  let changelog = '';
  if (existsSync(changelogPath)) {
    changelog = readFileSync(changelogPath, 'utf8');
  } else {
    changelog = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n';
  }

  // Format commits into changelog entry
  const commitLines = commits.split('\n').filter(line => line.trim());
  let changesList = '';

  if (commitLines.length > 0) {
    changesList = commitLines.map(line => {
      // Extract commit message (remove hash)
      const message = line.replace(/^[a-f0-9]+\s+/, '');
      return `- ${message}`;
    }).join('\n');
  } else {
    changesList = '- Version bump';
  }

  const newEntry = `## [${newVersion}] - ${date}\n\n${changesList}\n\n`;

  // Insert new entry after the header
  const headerEnd = changelog.indexOf('\n\n') + 2;
  changelog = changelog.slice(0, headerEnd) + newEntry + changelog.slice(headerEnd);

  writeFileSync(changelogPath, changelog, 'utf8');
  console.log(`Updated CHANGELOG.md with version ${newVersion}`);
}

// Create git tag
function createGitTag(version, commits) {
  const tagName = `v${version}`;
  const commitLines = commits.split('\n').filter(line => line.trim());

  let tagMessage = `Release ${version}\n\nChanges:\n`;
  if (commitLines.length > 0) {
    tagMessage += commitLines.map(line => {
      const message = line.replace(/^[a-f0-9]+\s+/, '');
      return `- ${message}`;
    }).join('\n');
  } else {
    tagMessage += '- Version bump';
  }

  exec(`git tag -a ${tagName} -m "${tagMessage}"`);
  console.log(`Created git tag: ${tagName}`);
}

// Main version bump function
function versionBump(type) {
  console.log(`\n🚀 Starting ${type} version bump...\n`);

  // Check for uncommitted changes
  try {
    const status = exec('git status --porcelain', true);
    if (status.length > 0) {
      console.warn('⚠️  Warning: You have uncommitted changes');
      console.warn('It is recommended to commit changes before bumping version\n');
    }
  } catch (error) {
    console.warn('Warning: Could not check git status');
  }

  // Read current version
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const currentVersion = packageJson.version;

  // Calculate new version
  const newVersion = bumpVersion(currentVersion, type);
  console.log(`Bumping version: ${currentVersion} → ${newVersion}\n`);

  // Get commits since last tag
  const commits = getCommitsSinceLastTag();

  // Update files
  updatePackageJson(newVersion);
  updateChangelog(newVersion, commits);

  // Stage changes
  exec('git add package.json CHANGELOG.md');
  console.log('Staged package.json and CHANGELOG.md');

  // Create commit
  exec(`git commit -m "chore: bump version to ${newVersion}"`);
  console.log(`Created commit for version ${newVersion}`);

  // Create tag
  createGitTag(newVersion, commits);

  console.log(`\n✅ Version bump complete!`);
  console.log(`\nNext steps:`);
  console.log(`  git push origin main`);
  console.log(`  git push origin v${newVersion}`);
  console.log(`\n`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const type = process.argv[2];

  if (!type || !['patch', 'minor', 'major'].includes(type)) {
    console.error('Usage: node scripts/version.js [patch|minor|major]');
    console.error('');
    console.error('Examples:');
    console.error('  node scripts/version.js patch   # 1.0.0 → 1.0.1');
    console.error('  node scripts/version.js minor   # 1.0.0 → 1.1.0');
    console.error('  node scripts/version.js major   # 1.0.0 → 2.0.0');
    process.exit(1);
  }

  try {
    versionBump(type);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

export { versionBump, bumpVersion };
