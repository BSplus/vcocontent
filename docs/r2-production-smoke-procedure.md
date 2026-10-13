# Controlled Production R2 smoke — proposed, not executed

## Status and approval boundaries

This document prepares the procedure only. No Production upload, object read or
delete, setting change, schema change or publish is authorized by its creation.
The current application has no smoke-only upload authorization. The scoped
exception and exact-key cleanup described below must be implemented and tested
locally, then published manually with operator approval before execution.

Keep `MEDIA_STORAGE_NEW_UPLOADS_ENABLED=false` throughout, including the test.
Do not briefly enable the global flag. Do not copy Development data to Production.
Preserve the Production-only startup exclusions and all fingerprint, credential,
EU bucket, safety, ownership and quota checks.

## Required smoke-only authorization

Proposed control: an authenticated, same-origin/CSRF-protected admin action
creates one bounded run. Installing the control must not automatically start a
run. Allow at most one active run; no automatic renewal or retry-run creation.
Every new run needs a new explicit admin start. No new Production environment
variable or long-lived secret is needed.

- Select existing, explicitly authorized eligible Creator/admin accounts and an
  existing non-admin account for denial checks. No signup, role, password or
  profile changes. Reuse existing authenticated sessions where possible.
- Allocate two NEW draft galleries: one Creator photo gallery and one official
  video event. Do not attach test media to an existing event or series, publish
  the galleries, select them as a cover, send gallery announcements or follow
  notifications. Keep normal safety checks in place.
- Mint server-generated opaque single-use upload permissions; store only their
  hashes server-side. Bind each to its existing authenticated actor/session,
  run ID, new event ID, media type, fixture digest and byte limit.
- Use a 15-minute authorization deadline, exactly two file-upload grants, and
  an atomically enforced maximum of five object creations / 5 MiB total stored
  bytes. Replays, expired grants and wrong actor/event/type/file fail closed.
- Consume a grant before starting work. A lost response is an uncertain result,
  not permission to upload again: inspect the authenticated run status first.
- Pass verified permission via internal request-scoped context, not
  `process.env`, a browser-controlled boolean, URL token or admin-role shortcut.
  Both the media-reservation gate and the object-write gate must check it.
- Preallocate and record the source/preview keys before writes. Object writes
  may target only the run's allowlisted UUID keys, with existing create-only,
  integrity and metadata checks. Never permit arbitrary keys or another provider.
- Normal requests, including the same accounts without a valid smoke grant,
  remain denied. Nextcloud and unrelated analysis jobs receive no exception.
- Safety/AI processing for these exact new media IDs remains normal. A narrowly
  bound worker permission may allocate one additional video poster, recorded
  before writing and counted against the five-object cap. No other background
  job receives permission; no exception beyond the run deadline.
- Credentials stay server-side. Send upload grants only through authenticated
  no-store responses and a redacted request header, never query strings.
  Do not log grants, cookies, passwords, keys, credentials or connection URLs.

Run grants are process-local for the current single VM. Restart/re-publish
invalidates them and stops the test. A non-secret client-side manifest must be
saved before writes; cleanup after a restart requires fresh operator approval
against that exact manifest, never automatic expansion of the object scope.
Do not add a schema or a persistent secret merely to keep test grants alive.

## Fixtures and manifest

Use a neutral generated JPEG of at most 512 KiB and a 2–5 second H.264 MP4 of at
most 2 MiB. No personal information, imported library files or external rights
questions. Record input SHA-256 and MIME before upload.

Expected scope: two galleries, two media items, four initial source/preview
objects, plus at most one replacement poster. Record all test-created
reservations, analysis/safety work, routing records, cleanup entries and download
records. A fifth object must belong to the same test video. Never exceed the cap
or silently enlarge cleanup.

The non-secret manifest records run ID, newly allocated row IDs, exact keys,
event/actor associations, expected sizes/MIME/digests and object versions. It
contains no session cookie, upload grant or credential. Save generated test
reports/manifests outside Git and publishing outputs.

## Execution order — requires separate explicit approval

1. **Read-only baseline and private-bucket review**
   - Record current users/roles, series, settings and existing content baseline
     without exporting personal data, credential fields or settings secrets.
   - Confirm effective runtime is Production; neither Development R2 variable
     reaches the application; Production credential selection is non-empty;
     database target matches its independently verified fingerprint.
   - Confirm private `vco-content-media`, EU endpoint and Standard writes.
     Operator checks Cloudflare public r2.dev/custom-domain access is disabled
     and credentials are bucket-scoped. Do not widen token permissions.
   - Capture only safe booleans, configuration checks and counts in the report.
     SDK construction / healthy startup alone is not a bucket-access PASS.

2. **Normal-upload denial BEFORE the test**
   - Create only the two authorized test galleries, then try a valid tiny upload
     through the ordinary route without a smoke grant: authorized Creator photo
     and authorized admin video. Check the actual launch-gate rejection, not
     merely a 404 for a nonexistent event or an unrelated permissions error.
   - Assert zero new media items, reservations, R2 routing rows and objects from
     rejected requests. Temporary multipart files must be removed.
   - Require the same denial for unrelated actors/events and replayed/expired
     permissions in local tests; a grant must not turn into an admin-wide bypass.

3. **Photo and video through the ordinary application pipeline**
   - Use the two narrowly authorized requests. Verify media-to-event/owner/key
     associations and `provider=r2`, `state=verified`; no Replit fallback.
   - Perform real Production S3 readback of only exact manifest keys. Match
     stored bytes, MIME, SHA-256 and version to the application routing record.
     Creator original/photo and video source should also match input digests;
     generated previews are compared to their own recorded output digests.
   - Decode photo preview and video poster. Wait for the test-only normal
     safety/AI jobs to settle; fetch fresh metadata before using a poster URL.
     A pending/error outcome is not a clean end-to-end PASS.
   - Verify one Creator photo and source+preview byte accounting, unchanged
     limits, and no new Creator video entitlement. Do not fill a real quota.

4. **Protected delivery and permissions**
   - Owner/admin authorized retrieval succeeds. Anonymous originals and another
     non-admin's private-gallery requests are denied without object bytes.
   - Unsigned S3 retrieval of a known existing test key must be denied; no public
     bucket, public presigned link or Development credential is used.
   - Full video GET matches source bytes/digest. Check `bytes=0-1023`, a nonzero
     range and a suffix range: exact 206 body, Content-Range, length and MIME.
     Check invalid/unsatisfiable range handling without leaking extra bytes.
   - Confirm actual browser playback advances without a media error. A 206
     response alone is not proof of playable video.
   - Any counted official-download test uses only the test video. Link issuance
     counts zero, completed authorized transfer one, and idempotent replay no
     additional count. Draft/public restrictions must not be bypassed to force
     this result: if a download workflow requires publication, keep this check
     deferred rather than publishing dummy content or weakening permissions.

5. **Revoke, drain and exact-scope cleanup — also on failure**
   - Revoke both upload grants immediately; the global gate never changes.
     Stop only test-owned jobs and wait for in-flight writes before deleting.
   - Persist cleanup intent for exact manifest keys before removing their own
     media records, using existing cleanup/routing structures only.
   - A dedicated smoke cleanup operation must prove each row/key was created by
     this run and is not referenced by existing content/reference documents.
     Never call the broad admin cleanup endpoint or the current unscoped
     cleanup routine as the smoke cleanup mechanism.
   - Remove only test-owned media/dependent rows and exact R2 keys. Verify each
     object is actually absent via signed HEAD/GET, not merely hidden by app
     permissions. Then remove the run's now-unneeded routing/cleanup records
     after checking references. Retain the two empty test galleries until the
     final ordinary-upload denial check in step 6.
   - On any ownership, integrity or reference ambiguity, stop deletion and
     report exact unresolved manifest entries. Never broaden deletion to a
     prefix/bucket, existing Creator gallery or whole table.
   - Do not claim cleanup complete or smoke PASS while a job, reservation,
     object or cleanup entry remains. Keep normal uploads closed regardless.

6. **Normal-upload denial AFTER the test and final evidence**
   - Revoke grants and repeat the ordinary upload denial on the still-existing
     test galleries before their final removal; require the same gate-specific
     denial and no persisted media/object. Do not use deleted-event 404 as proof.
   - Delete the two manifest-owned galleries only after this check and after
     confirming they are empty and have no unrelated references.
   - Confirm runtime flag remains `false`, grants invalid, every manifest object
     absent, all run-owned rows gone, and protected baseline records unchanged.
     Account for unrelated concurrent legitimate activity rather than deleting
     it to force an exact count match.
   - Report PASS/FAIL separately for bucket access/privacy, integrity/routing,
     previews, video/browser/Range, app permissions, Creator accounting,
     ordinary upload denial and cleanup. Distinguish actual checks from deferred
     checks and startup-only evidence.

## Manual operator steps

1. Approve implementation of the narrow authorization and exact-key cleanup.
2. Identify the existing accounts allowed to participate; do not send passwords
   or cookies in chat. Review Cloudflare private access and bucket token scope.
3. After local tests pass, manually publish the reviewed code with the database
   copy option unchecked and the normal upload flag still `false`. Review the
   schema diff: this feature requires NO schema changes.
4. Separately approve one bounded run, including creation and deletion of only
   the manifest-owned test data. Start the authenticated admin control.
5. Review the report and cleanup evidence. Enabling general uploads remains a
   separate decision after PASS, not a consequence of running the smoke.

The deployment may remain public because the new exception is actor/session/
event/key bounded and normal uploads remain closed. Platform-private isolation
is optional additional protection, not a substitute for application permission
checks. Do not change deployment visibility automatically.
