#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Restore the exact locked dependencies after an isolated task is merged.
# Database changes are deliberately not pushed automatically.
npm ci --no-audit --no-fund
npm run check
npm run build