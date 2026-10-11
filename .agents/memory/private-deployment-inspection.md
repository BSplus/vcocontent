---
name: Private deployment inspection
description: Distinguish Replit's deployment access gate from the application's own public-data permissions during read-only checks.
---

A redirect to Replit's access gate does not mean the application's public API or reported event is unavailable. If an existing external deployment-access token is available, consult the current Replit documentation and use it only at runtime for same-origin requests. Never print it or persist it in reports.

**Why:** An anonymous live check initially appeared inaccessible, but read-only inspection with the existing deployment token reproduced a real search failure that the unrelated development dataset could not demonstrate.

**How to apply:** Keep deployment access separate from app login and media eligibility. Limit token-bearing browser request interception to the exact verified production origin; do not attach it globally to third-party image or asset requests. Read-only production checks do not authorize publication or data changes.
