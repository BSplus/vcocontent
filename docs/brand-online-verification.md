# Optional online brand existence check

## Current operator-approved rule

This is a lightweight **existence sanity check**, not strict company or legal
identity verification. A matching website (MOZA RACING → mozaracing.com) **or**
a normal search result naming the brand/products is enough. Retailer and product
results count. Some errors are acceptable; the objective is to avoid imaginary
or obviously nonexistent brands without making recognition unusable.

No official-source classification, exact verbatim quote, structured JSON
verdict, matching classifier URL or secondary model verification is required.
This replaces the earlier overly strict evidence gate.

The independent on-car visual checks remain unchanged. Online existence does
not prove that a logo appears on the car, identify a team or establish a
sponsorship relationship. Ordinary tags, captions, entry matching, permissions
and independent publication safety remain unchanged.

## Implementation and limits

- The shared photo/video analysis worker filters automatically generated brand
  tags before saving them. A failed/uncertain lookup omits **only** brand tags:
  it cannot reject committed uploads or become a publication success condition.
  Editor-authored tags and removals are not retroactively overwritten.
- Uses the existing managed OpenAI hosted web search with one request per
  uncached lookup, no second classification request, no retries or new secrets.
  Sends only the candidate name, not images, filenames, events or accounts.
- Requires an actual completed web search and a usable cited search result
  or tool-returned source. A successful HTTP response or unbacked model assertion
  alone does not count.
- Either a domain label matching the space/punctuation-normalized brand name,
  or a source title naming the brand, suffices. Plain prose and tracking-query
  differences do not invalidate results. Registered company identity and
  exclusivity of the name are not investigated.
- Clearly fictional/nonexistent-only result titles are excluded. Unrelated
  results, empty search evidence, guessed aliases and lookalike domains with
  neither a matching label nor a named brand/product result do not pass.
- Source URLs are HTTPS without credentials. The app does not fetch
  model-supplied websites itself; retrieval stays with the hosted web tool.
  Receipts use the neutral `sourceUrl` field: a result need not be official.
- Existing bounded process-local cache remains: 256 names, positive 24 hours,
  negative 1 hour, lookup failure 2 minutes. Same-name requests coalesce.
- One uncached candidate per analysis and one concurrent lookup per process;
  already cached brands remain available. Additional unresolved names are
  omitted rather than delaying ordinary tagging indefinitely.
- Optional overall deadline: 6.5 seconds, outside transactions and the numeric
  Vision slots. A cold lookup can add bounded background-analysis latency;
  errors/timeouts never fail ordinary analysis.
- No database/schema changes, new services, archive reanalysis or cleanup.

## Verification

Current simplified implementation, 14 October 2026:

- TypeScript check and production build passed.
- 21 focused checks passed: named product results, retailer results, matching
  domains with generic titles, tracking URL differences, legacy/new search
  records, no secondary classifier, non-Latin names, unrelated/fictional results,
  coalescing/cache expiry and failure/timeout behaviour.
- Three selected disposable-database integration checks passed: persisted photo
  brand search and caption/identity preservation; no-entry-list/no-number
  recognition and editor suppression; failed web lookup preserving ordinary
  tags and finishing analysis. The other 26 photo tests were deliberately
  skipped in this focused run, not claimed as rerun.
- **One real Development lookup passed.** Managed provider returned HTTP 200;
  MOZA RACING was accepted with source
  `https://us.mozaracing.com/pages/about-us`. One web request, approximately
  3.4 seconds; ordinary `Day` tag preserved. No classification request.

Earlier strict-gate attempts reached real web sources and a positive classifier
verdict but failed the application's overly strict acceptance. Those historical
failures are superseded by the current operator-approved existence check.

The live test confirms the online existence check, not the accuracy of reading
every logo in actual photos/videos. The on-car visual pipeline is unchanged.
No Production data, settings, credentials or publishing were changed.
