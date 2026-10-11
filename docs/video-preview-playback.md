# Video preview playback

## Confirmed observations

The untouched baseline was archived and built separately; the working app and
user files were not reverted or changed for the comparison. Its real file route
and four original UI views were exercised with synthetic signed-in identities
and a generated 24-second H.264 / yuv420p MP4 (moving test pattern, moov at the end).

**The baseline plays that valid fixture in all four views.** Decoded dimensions
were 160 × 90 and currentTime passed 0.5 seconds in gallery, home, detail and
editor. This does **not** reproduce the reported blanket failure for a concrete
user file. It proves that missing Range support alone is not an established
explanation for that report.

However, every baseline browser `Range: bytes=0-` request received `200`, without
`Accept-Ranges`, `Content-Range`, or an explicit original-object length. The
original routes had no single-range handling. The original player views had no
visible media-error state; some also silently fell back to a poster when a URL
was missing. These are confirmed delivery/diagnostic defects, now fixed.

There are no existing video files in this isolated checkout's attached assets.
No affected user's private original, production session, live object or
production playback was accessed. Concrete file/session/access/codec causes
remain unconfirmed; do not label them “fixed by Range support”.

## Changes

- Visibility, creator ownership, suspension, login and premium decisions remain
  in the original routes and run before metadata/bytes, including HEAD and Range.
- Video objects use the supported GCS client against the same private default
  Replit bucket. The installed Replit SDK does not expose length or range reads.
  Bucket lookup uses the same platform sidecar and managed credential exchange;
  no credentials, bucket links or signed URLs go to the browser.
- Native reads request only the selected interval and pin the metadata generation.
  Responses have exact Content-Length, Accept-Ranges, 206/Content-Range and 416
  for unsupported/invalid ranges. If-Range without a matching advertised
  validator receives the full representation. HEAD sends no body.
- Legacy video Base64 remains in the existing database; requested spans are
  decoded in at most 48 KiB chunks, not another complete binary video buffer.
  The historical 100 MiB ceiling remains. No migration/transcoding.
- Streams use backpressure; client disconnect/error/120-second deadline destroys
  the upstream. Bucket/metadata requests have 15-second deadlines. Object and
  legacy video responses remain private/no-store.
- One shared player supports controls, playsInline, metadata loading, visible
  English source/session/access/network/decoder messages and retry. It never
  autoplays thumbnails. Failed app-owned sources are diagnosed with an
  authenticated HEAD, not a complete extra download or an external URL probe.
- Closing, route changes and media switches pause and remove the old source.
  Gallery navigation ignores arrow keys focused on VIDEO so controls can seek.

## Verification

Run `npm run test:video-playback` (builds the production UI first), then
`node --test tests/ui-click-targets.test.mjs` against the running preview.

The tests use actual Chromium decoding, native play controls and actual Express
file routes. Only test identity/metadata/object transport are synthetic.
No database writes, App Storage writes, AI requests, publication, new hosting
or changes to existing files are involved.

Covered:

- Object and legacy full/HEAD, bounded/open/suffix ranges, oversized end and
  suffix, malformed/reversed/unsatisfiable/multipart ranges, 416 length,
  If-Range fallback and exact bytes/headers.
- Anonymous/suspended/premium/hidden/draft/safety-rejected/outsider denial;
  owner/Admin permissions remain. Authorization precedes object access.
- Disconnect and failures before and during transfer; native interval and
  generation pinning. Bounded legacy decoding.
- Gallery, home dialog, detail and editor at 1280 and 390 CSS pixels, including
  trusted touch input. Real play, advancing currentTime, changing canvas pixels,
  pause, forward seek to 17 seconds and backward seek to 3 seconds.
- Legacy media switching, dialog closing, detail navigation, old-player stop
  and gallery opener focus; existing selection/navigation checks remain separate.
- Missing URL, damaged MP4, unsupported MPEG-4 Part 2 codec (actual browser media
  errors), expired identity (401), premium denial (403), unavailable object
  (502), deleted record (404), anonymous poster and successful retry.

Browser error assertions are scoped to alert/status content, not gallery captions
or the site's separate rights notice. Fresh query-string fixtures force a new
media transfer when simulating revoked access; Chromium can otherwise reuse an
already-buffered source. Already-delivered bytes cannot be revoked retroactively.

### Workspace results and limits

Type checking and the production build passed. The object/legacy delivery tests
passed, including all authorization/range checks and interrupted transfers.
Actual-browser runs recorded successful motion/time/pause/forward/backward seek
for all four views at both desktop and touch widths. The separately scoped
English-error/retry test passed with actual 206/401/403/404/502 route responses.
The untouched-baseline probe also completed successfully.

The combined expanded regression run was interrupted after excessive runtime in
this workspace; it is **not** reported as a complete green suite. Additional
existing image/video-ingestion checks were not green: the existing photo-quality
test hit its optimization work budget instead of its expected quality-limit
error, and the existing ingestion check did not reach its mocked provider call
before its polling deadline. These were parallel, resource-heavy runs; their
specific causes were not established or changed in this playback task. Do not
interpret them as a proven playback regression or silently waive their checks.
Repeat the documented focused commands in a stable, non-overlapping test run.

## Remaining limits

- Real Safari/iOS/Android devices and production object transport are not covered
  by local Chromium touch emulation. The existing live-media follow-up covers the
  production check; no publication was authorized here.
- MP4/MOV describe containers, not guaranteed browser codecs. Unsupported or
  damaged originals receive a clear message, not silent automatic conversion.
- This is not a claim that every existing user video now decodes. A specific
  failing original still needs its actual URL/status/headers, browser media code
  and codec checked with the operator's access/permission.
- Per-request metadata requires a storage round trip. No private byte cache,
  public bucket, new service or new paid processing pipeline was introduced.

Baseline comparison can be repeated with
`VIDEO_BASELINE_ROOT=<archived-worktree> node --import tsx scripts/probe-video-preview-baseline.mjs`
after building that archived UI. It uses only synthetic records and identities.
