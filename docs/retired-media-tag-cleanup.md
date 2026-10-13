# Retired media tag cleanup

The application no longer generates or accepts the whole tag `Real Motorsport`
(including case and whitespace variants). Custom tags and identity/description
fields are not otherwise reclassified.

Read-only preflight on 13 October 2026: development has no occurrences.
Production has one occurrence in `media_items.tags` and one in
`media_analysis_jobs.generated_tags`; manual/suppressed arrays have none.
Production was not modified. These counts are an initial scope check, not
authorization to apply; repeat the pinned plan in the target environment after
merging, immediately before an approved application.

## Controlled existing-data cleanup

Run only after merging the new write guards. Do not run against production from
the task workspace or put this operation in application startup/build hooks.

1. In the intended database environment, run:
   `node --import tsx scripts/remove-retired-media-tag.mjs`
2. Review the affected row counts and occurrence counts for `media_items.tags`,
   `manual_tags`, `suppressed_ai_tags`, and `media_analysis_jobs.generated_tags`.
   The default operation is read-only; it prints no captions or media contents.
3. With operator approval, apply that exact plan:
   `node --import tsx scripts/remove-retired-media-tag.mjs --apply --expected=<fingerprint>`
   Production additionally requires `--production-reviewed`.
4. Retain the count/fingerprint output in the operator's maintenance log.
   Run the read-only command again and confirm zero remaining occurrences.

Application and cleanup use the existing configured database; no database is
replaced. The transaction briefly locks both tables (five-second lock timeout),
rejects a changed plan, verifies all other row fields are unchanged, and rolls
back on any failed check. All media, other tags (including order and duplicates),
NULL arrays, timestamps, safety states, identity fields and historical frame
evidence stay intact. Repeating the cleanup is safe. No historical evaluation
files are modified. Cached video frames are filtered again when aggregated so
old evidence cannot restore the retired tag.
