#!/usr/bin/env node
// Compatibility entry point. The secure updater now uses Python's standard library.
// Requires Python 3.11+ and API_FOOTBALL_KEY in the environment.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
  [path.join(__dirname, 'fetch_data.py')], { stdio: 'inherit', env: process.env });
if (result.error) { console.error('Install Python 3.11+ or run the GitHub Actions workflow.'); process.exit(1); }
process.exit(result.status === null ? 1 : result.status);
