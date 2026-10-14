# Optional online brand verification

## Operator's requirement

Automatically recognized brand/company names need an online existence check
before becoming searchable brand tags. Unclear names, ambiguous matches,
unavailable checks and timeouts omit **only** the brand tag. They must not
reject an upload, prevent publication, fail ordinary tagging or gate entry-list
matching. No fuzzy correction to a conveniently similar real company.

Both requirements apply: independently checked on-car pixel evidence **and**
online naming evidence. A real company found online does not prove that its
logo appears on the car. A logo does not establish a sponsorship contract.

## Implementation and boundaries

- The shared photo/video analysis worker filters automatic brand tags before
  saving/merging them. Ordinary scene tags, identity matching, caption handling,
  editor suppression, permissions and independent publication safety remain
  unchanged. Manual/editor-authored tags are not retroactively deleted.
- Uses the existing managed OpenAI integration, with no new credentials or
  schema. Sends the candidate company name, not photos, filenames, event details
  or account information, to the hosted web lookup.
- Requires a completed real web-search record, a completed verdict, an exact
  observed-name match, unambiguous authoritative/official naming evidence,
  and an actual cited HTTPS URL whose source title names the brand.
- Model memory, URL guesses, invented aliases, retailer/directory-only mentions
  and an HTTP 200 by themselves are insufficient.
- Hosted search may return cited prose instead of the requested JSON. A small
  structured classification then assesses only that retrieved evidence. Its
  quote must occur in the retrieved text; its URL must be an actual source
  citation. Pretty-printed valid JSON is supported without accepting multiple
  or partial verdicts.
- The app does not fetch model-supplied websites itself. Source retrieval stays
  with the hosted web tool; no arbitrary-host application fetch is introduced.
- One uncached name lookup per analysis; one concurrent lookup per process,
  with same-name in-flight coalescing. Cached confirmed brands remain available
  when another name is being checked. Additional unresolved names are omitted.
- A lookup needs one web request and, if the reply is prose, at most one small
  classification request. Overall optional deadline: 6.5 seconds; no retries.
  This runs in background analysis, outside DB transactions and the numeric
  Vision slots. It can add bounded background-analysis latency but never becomes
  a required success condition for uploads/publication/ordinary tags.
- Bounded process-local cache: 256 names; positive 24 hours, negative 1 hour,
  transport/deadline failures 2 minutes. Cache receipts contain only brand,
  public source URL and check time. Restart loses this cache, never trusts it as
  persisted approval. Multiple app processes have separate caches.
- No automatic old-media reanalysis or cleanup. No Production changes or publish.

## Verification status

- Earlier disposable-DB run: 45 checks passed, including photo brand search,
  no-entry-list operation, editor suppression, caption preservation, and a failed
  online check that still finishes ordinary analysis and saves ordinary tags.
- Further isolated checks cover pretty-printed JSON, multi-verdict rejection,
  source-quote provenance, the two-stage retrieval/classification path and
  non-Latin brand-name matching.
- Development live probes reached the existing hosted web tool successfully
  (HTTP 200 with actual completed search records and URL citations). The
  structured-classification endpoint also returned HTTP 200.
- Those probes did **not** produce an accepted MOZA RACING receipt in the code
  version tested live. Local investigation identified overly strict single-line
  JSON handling; the corrected complete-object parser passes local tests.
  One operator-authorized final Development check after that correction was
  performed on 2026-10-14. It made exactly one web request and one structured
  classification request (both HTTP 200), completing in approximately 3.5 seconds.
  The web response contained a completed search record and one actual source
  citation whose title named MOZA RACING. The classifier returned the exact name,
  confirmed=true, ambiguous=false and the official site `https://mozaracing.com/`.
  Nevertheless, the application's stricter source-evidence acceptance did
  **not** produce a receipt: the brand tag was omitted and the ordinary `Day`
  tag remained. The bounded probe did not identify which exact source guard
  rejected the evidence. Do not claim a proven quote/URL mismatch, or describe
  positive real-provider brand verification as passed.
- Repeated live probes were stopped rather than relaxing source/name safeguards.
  Unknown brands remain omitted, and ordinary tags are preserved.

No Production data, settings, credentials or deployment were changed.
