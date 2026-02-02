/**
 * Build Info Accessor
 * Provides version and build information to the React app
 * Import this file to display version info in Settings or footer
 *
 * Example usage:
 *   import buildInfo from './buildInfo.js';
 *   console.log(buildInfo.version); // "1.0.0"
 *   console.log(buildInfo.fullVersion); // "1.0.0 (build 42)"
 */

let buildInfo;

try {
  // Import the generated build-info.json
  buildInfo = await import('./build-info.json', { assert: { type: 'json' } });
  buildInfo = buildInfo.default;
} catch (error) {
  // Fallback if build-info.json doesn't exist (e.g., dev mode without build)
  console.warn('Build info not found, using defaults');
  buildInfo = {
    version: '1.0.0',
    buildNumber: 0,
    buildDate: new Date().toISOString(),
    gitCommit: 'unknown',
    gitCommitShort: 'unknown',
    gitBranch: 'unknown',
    isDirty: false
  };
}

// Helper to format version with build number
const fullVersion = `${buildInfo.version} (build ${buildInfo.buildNumber})`;

// Helper to format build date
const formattedBuildDate = new Date(buildInfo.buildDate).toLocaleString();

// Export all build info plus helpers
export default {
  ...buildInfo,
  fullVersion,
  formattedBuildDate
};
