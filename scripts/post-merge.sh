#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

run_step() {
  local label="$1"
  shift
  local started="$SECONDS"
  printf '\n[post-merge] Starting %s\n' "$label"
  "$@"
  printf '[post-merge] Completed %s in %ss\n' "$label" "$((SECONDS - started))"
}

# Install from the merged lockfile without deleting node_modules: the running
# Vite workflow writes its cache there until workflow reconciliation restarts it.
# Reject package/lock mismatches instead of silently changing the merged lock.
touch .post-merge-installing
# Leave the marker on failure: a partially installed tree must not be served.
lock_before="$(sha256sum package-lock.json | cut -d' ' -f1)"
run_step "dependency installation" npm install --no-audit --no-fund
lock_after="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [[ "$lock_before" != "$lock_after" ]]; then
  echo "package-lock.json changed during post-merge setup; commit a matching lockfile with dependency changes." >&2
  exit 1
fi

# Apply only the reviewed, additive development changes from this feature.
# Production schema is not modified by this script.
run_step "additive development schema" node --import tsx scripts/apply-dev-process-schema.mjs
run_step "type checking" npm run check
run_step "production build" npm run build
rm .post-merge-installing
printf '[post-merge] Setup complete; workflow reconciliation can restart the app.\n'