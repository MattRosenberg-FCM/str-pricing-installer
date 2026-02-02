#!/usr/bin/env node

/**
 * Build Info Generator
 * Generates build metadata file before each build
 * Contains: version, buildNumber, buildDate, gitCommit, gitBranch
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Helper to execute git commands safely
function gitCommand(command) {
  try {
    return execSync(command, { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch (error) {
    console.warn(`Warning: Git command failed: ${command}`);
    return 'unknown';
  }
}

// Read current package.json version
function getVersion() {
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  return packageJson.version;
}

// Read or initialize build number
function getBuildNumber() {
  const buildInfoPath = join(rootDir, 'src', 'build-info.json');

  if (existsSync(buildInfoPath)) {
    try {
      const buildInfo = JSON.parse(readFileSync(buildInfoPath, 'utf8'));
      return (buildInfo.buildNumber || 0) + 1;
    } catch (error) {
      console.warn('Warning: Could not read existing build number, starting from 1');
      return 1;
    }
  }

  return 1;
}

// Generate build info
function generateBuildInfo() {
  const version = getVersion();
  const buildNumber = getBuildNumber();
  const buildDate = new Date().toISOString();
  const gitCommit = gitCommand('git rev-parse HEAD');
  const gitCommitShort = gitCommand('git rev-parse --short HEAD');
  const gitBranch = gitCommand('git rev-parse --abbrev-ref HEAD');
  const gitStatus = gitCommand('git status --porcelain');
  const isDirty = gitStatus.length > 0;

  const buildInfo = {
    version,
    buildNumber,
    buildDate,
    gitCommit,
    gitCommitShort,
    gitBranch,
    isDirty
  };

  // Ensure src directory exists
  const srcDir = join(rootDir, 'src');
  if (!existsSync(srcDir)) {
    mkdirSync(srcDir, { recursive: true });
  }

  // Write build info file
  const buildInfoPath = join(srcDir, 'build-info.json');
  writeFileSync(buildInfoPath, JSON.stringify(buildInfo, null, 2) + '\n', 'utf8');

  console.log('Build info generated:');
  console.log(`  Version: ${version}`);
  console.log(`  Build: #${buildNumber}`);
  console.log(`  Date: ${buildDate}`);
  console.log(`  Commit: ${gitCommitShort}${isDirty ? ' (dirty)' : ''}`);
  console.log(`  Branch: ${gitBranch}`);
  console.log(`  File: ${buildInfoPath}`);

  return buildInfo;
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    generateBuildInfo();
    process.exit(0);
  } catch (error) {
    console.error('Error generating build info:', error.message);
    process.exit(1);
  }
}

export { generateBuildInfo };
