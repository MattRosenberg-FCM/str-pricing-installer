/**
 * Version Display Component
 * Shows app version and build info
 * Use in Settings panel, About dialog, or footer
 */

import { useState, useEffect } from 'react';

function VersionDisplay({ variant = 'full' }) {
  const [buildInfo, setBuildInfo] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Dynamically import build info
    import('../buildInfo.js')
      .then(module => {
        setBuildInfo(module.default);
      })
      .catch(err => {
        console.warn('Could not load build info:', err);
        setError(true);
      });
  }, []);

  // Loading state
  if (!buildInfo && !error) {
    return null;
  }

  // Error state - show minimal version from package.json
  if (error) {
    return <span className="text-gray-500 text-sm">Version 1.0.1</span>;
  }

  // Compact variant - just version number
  if (variant === 'compact') {
    return (
      <span className="text-gray-500 text-sm">
        v{buildInfo.version}
      </span>
    );
  }

  // Short variant - version and build number
  if (variant === 'short') {
    return (
      <div className="text-gray-600 text-sm">
        <span className="font-medium">Version {buildInfo.version}</span>
        <span className="text-gray-500"> (build {buildInfo.buildNumber})</span>
      </div>
    );
  }

  // Full variant - all details
  return (
    <div className="space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700">Version:</span>
        <span className="text-gray-600">{buildInfo.fullVersion}</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-700">Built:</span>
        <span className="text-gray-600">{buildInfo.formattedBuildDate}</span>
      </div>

      {buildInfo.gitCommitShort !== 'unknown' && (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700">Commit:</span>
          <code className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
            {buildInfo.gitCommitShort}
            {buildInfo.isDirty && <span className="text-orange-600">*</span>}
          </code>
        </div>
      )}

      {buildInfo.gitBranch !== 'unknown' && (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-700">Branch:</span>
          <code className="text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
            {buildInfo.gitBranch}
          </code>
        </div>
      )}
    </div>
  );
}

export default VersionDisplay;
