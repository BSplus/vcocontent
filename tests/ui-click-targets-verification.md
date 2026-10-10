# Click-target verification

## Before changes

Chromium checks at 1280px desktop and 390px touch emulation confirmed:

- Two hero search links, although the right one resembled an input and accepted no text.
- Navigation labels “Current” and “Creators”.
- Featured media opened previews, but displayed bare download numbers and no visible preview action.
- Shared-grid actions were labeled “Open”, “View”, “Details” and “Download”.
- The Creator edit action had a parent with opacity 0 without hover on both viewports.
- Upcoming listings already had no gallery links; no new calendar destination was needed.

One additional code finding: admin checkbox selection never activated the existing thumbnail-selection branch. The existing mode is now activated by selection and exits after the final item is deselected or selection is cancelled.

## Focused automated checks

Run `node --test tests/ui-click-targets.test.mjs` against the configured development URL, or set `TEST_BASE_URL`.

The browser intercepts API responses with isolated fixtures; no accounts, events or media are created or updated. Native mouse, touch and keyboard input verifies:

- A single hero media-search CTA and the retained navigation search.
- Visible preview cues and download statistics on both highlighted media sections.
- Preview dialogs, detail navigation and quality menus as distinct actions.
- Anonymous video poster versus signed-in video controls.
- Calendar entries remain noninteractive.
- Visible Creator editing via touch and Enter; dialog focus and return to the edit opener.
- Admin Select/Deselect labels, pressed state, and independent explicit Preview action.
- Navigation labels, role-specific destinations, menu closure and no horizontal overflow at 320, 390, 1024, 1280, 1536 and 1920px for anonymous, registered, creator, approved-without-flag and admin roles.
- CSS viewport dimensions match the intended emulation size.
- Real anonymous Creator/Admin API requests still return 401.

## Authorized extension: recognition and reference controls

The user approved completing the already-present recognition/reference UI after the completion check found ordinary media saves failing, missing reference endpoints, and ineffective reanalysis.

Run with the preview stopped, serially:

`node --import tsx --test --test-concurrency=1 tests/entry-list.test.mjs tests/recognition-reference-api.test.mjs tests/media-processes.test.mjs`

- Authenticated API checks persist ordinary caption/tag edits, entry corrections and reference-session fields using disposable development accounts/events/media.
- Reference checks cover import, private source download, identical and changed-source reimport, corrections, removal and series/year/owner-isolated season inheritance.
- Explicit reanalysis creates a new generation, uses updated references, does not replace active jobs, and preserves concurrent caption/entry edits and removed generated tags.
- Search can use the already-present identification filter. Invalid fields are rejected; selecting only captions does not accidentally search entry data.
- All fixtures are removed. Source-object storage and AI responses are isolated test transports, not real provider calls.
- Automatic upload tagging remains unchanged; only explicit editor requests extract entry metadata. Captions are never automatically replaced.
- The browser check also exercises the reference-session and race-number inputs with native keyboard/touch input.
- `node --test tests/editor-tag-roundtrip.test.mjs` verifies remove → save → reopen → reanalyse → save at desktop and touch widths. Completion merges the effective persisted tag list, never suppressed raw AI output, while retaining draft additions/removals.

## Verification limits

- Role-specific browser data is mocked. These checks do not prove authenticated backend ownership against the current database, and touch emulation is not a physical-device test.
- Existing download-policy unit tests cover anonymous VCO low-resolution photos, signed-in high-resolution/creator downloads, and denied premium media. The backend policy was not modified.
- The missing additive recognition schema was applied only to the development database. No production schema or data was changed.
- Production startup now has a read-only schema-readiness gate before routes/workers/listening. A missing migration or unverifiable schema refuses startup explicitly; it never runs DDL. Apply the approved schema through the deployment database workflow before serving this release.
- The production build and full TypeScript check succeed, including the six previously failing backend locations.
- Live development checks for `/api/events` and `/api/media` now return 200 after the additive schema update; the initial 500 failures are resolved.
- Existing authentication, download permissions and event ownership boundaries remain in place. The new reference routes use the same Creator-owner/Admin boundary as existing media edits.
