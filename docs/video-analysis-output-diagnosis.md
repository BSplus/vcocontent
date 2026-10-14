# Video AI response diagnosis — 14 October 2026

## Actual Production result

Read-only inspection of event 230 found five videos:

- 1214, 1339 and 1340 completed.
- 1215 and 1219 failed after three attempts, all at `result_parsing /
  AI_OUTPUT_INVALID`, with zero successfully saved recognition frames.
- Both failing clips sampled eight frames. Three provider responses were
  received per clip; available usage was retained. Completion tokens totalled
  1,244 and 1,159 respectively across the three requests. This does not indicate
  repeated exhaustion of the 2,400-token per-response limit.
- Their exact rejected response shape cannot be established retroactively:
  Production stored only a generic failure code, not response bodies or a
  structural reason. No raw provider output was retrieved, no clip was manually
  retried and no provider comparison was run.

Do not describe the two clips as recovered or claim that a particular missing
field was confirmed in their historical responses.

## Confirmed implementation gap and focused hardening

The old request asked for generic `json_object` output. Its parser nevertheless
required every indexed frame and valid vehicle fields. A missing frame, duplicate
or out-of-range index, null number, malformed JSON, oversized content or non-stop
finish reason all produced the same generic diagnostic.

Development now:

1. Requests strict structured output from the existing `gpt-4.1-mini` model,
   with required frame records, bounded fields, zero-based indices, explicit
   unknown values and no extra properties.
2. Explicitly instructs the model not to merge, omit or renumber input frames.
   Empty scenes still have a record with empty observations.
3. Preserves the local completeness/index checks and existing vehicle parser.
   Provider structure is not evidence of a correctly read number.
4. Records only static structural labels, whitelisted finish reasons and small
   frame counts. No response text, URLs, image payloads, credentials or tokens
   are logged in these diagnostics.
5. Keeps retry limits, frame/request budgets, usage accounting, original files,
   previews, captions and manual metadata intact. Invalid output is not salvaged
   into invented frame evidence.

The separately prepared upload fallback still persists event captions before
optional analysis. This change does not bypass publication safety or replace
user-written captions.

## Verification

- TypeScript check and production build passed.
- 24 pure response-contract and independent-number evidence checks passed.
- The video integration/failure suite passed its 18 other checks initially; its
  existing reference-rematch assertion ran before an asynchronous revision had
  finished. The fixture now waits for the completed reference revision. That
  check and the two adjacent retry/history checks then passed in a focused run.
  All 19 distinct integration/failure checks have a passing result.
- Real generated MP4/WebM extraction, bounded frame sampling, preserved previews,
  corrupt originals, lease fencing, provider failures, retries, local reference
  rematching, manual captions/tags and historical evidence rejection were covered.
- A generated MP4 with an intentionally incomplete provider response retained
  its original URL, actual preview and caption, recorded `frame_count`, and then
  completed tagging on a valid retry.
- Provider calls were mocked. No paid live recognition or current Production
  endpoint acceptance of the new structured-output request was tested.

## Release boundary

No publish, Production setting change, schema change, manual retry or live data
mutation was performed.

After an approved publish, separately authorize a targeted retry of media 1215
and 1219. Confirm provider acceptance of the structured request, completion,
persisted tags and actual number evidence. Successful tagging does not imply a
legible race number exists; an uncertain number must remain unmatched. If either
clip still fails, the new structural diagnostic provides a safe next cause to
investigate without logging its raw response.
