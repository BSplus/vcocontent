---
name: Live smoke object scope
description: Count background media-processing writes in strict live-test allowlists.
---

Count automatic follow-up writes, not only the initial upload pair, when defining
an exact live smoke-object allowlist. Do not silently broaden cleanup if the
ordinary processing pipeline produces another test-owned key.

**Why:** A four-object photo/video smoke unexpectedly produced a replacement
poster during video AI processing while its original poster waited for cleanup.
The operator explicitly required stopping if a cleanup safeguard failed.

**How to apply:** Before live approval, reconcile the proposed object count with
background analysis/preview replacement. Agree transient-object ownership and
cleanup scope or a supported way to avoid replacement; stop and seek permission
when that scope is exceeded. Keep original-library and Production boundaries.

Record the method, path (without bearer query tokens), stage and status for each
smoke request. Refresh authorized metadata after automatic AI completes before
testing poster URLs; a URL captured from the upload response may be retired.

**Why:** The original grouped failure recorded only “404 != 200” and was
incorrectly labelled a photo failure. Its exact request is no longer provable
after cleanup; isolated reproduction confirms the stale-poster failure mechanism.

**How to apply:** Keep historical facts separate from reproducible hypotheses.
Do not weaken authorization or add legacy-provider fallback to make a retired
key work, and do not claim an untraced historical error conclusively fixed.

Verify persisted public eligibility before putting private test media in an
official event; do not assume Creator draft behavior applies to official events
or that submitted visibility fields were accepted.

**Why:** Official and Creator creation have different visibility defaults, and
public creation validation deliberately excludes internal moderation fields.
A successful creation response therefore does not establish fixture privacy.

**How to apply:** Establish and verify the isolated event's actual privacy before
any upload. Never weaken application input validation to make a fixture pass.
