#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Install from the merged lockfile without deleting node_modules: the running
# Vite workflow writes its cache there until workflow reconciliation restarts it.
# Reject package/lock mismatches instead of silently changing the merged lock.
touch .post-merge-installing
# Leave the marker on failure: a partially installed tree must not be served.
lock_before="$(sha256sum package-lock.json | cut -d' ' -f1)"
npm install --no-audit --no-fund
lock_after="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ "$lock_before" != "$lock_after" ]]; then
  echo "package-lock.json changed during post-merge setup; commit a matching lockfile with dependency changes." >&2
  exit 1
fi

# Apply only the reviewed, additive development changes from this feature.
# Production schema is not modified by this script.
node --import tsx scripts/apply-dev-process-schema.mjs
npm run check
npm run build
rm .post-merge-installing