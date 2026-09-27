#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Install from the merged lockfile without deleting node_modules: the running
# Vite workflow writes its cache there until workflow reconciliation restarts it.
# Reject package/lock mismatches instead of silently changing the merged lock.
lock_before="$(sha256sum package-lock.json | cut -d' ' -f1)"
npm install --no-audit --no-fund
lock_after="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ "$lock_before" != "$lock_after" ]]; then
  echo "package-lock.json changed during post-merge setup; commit a matching lockfile with dependency changes." >&2
  exit 1
fi

# Database changes are deliberately not pushed automatically.
npm run check
npm run build