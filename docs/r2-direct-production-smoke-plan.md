# Direct Production R2 smoke — prepared only

This is the current operator-selected procedure. Do not implement the previously
proposed smoke authorization or cleanup features. Use existing application
uploads/deletion only. No migration, schema change, existing-data cleanup,
Production setting change, test execution or publish is authorized yet.

## Verified during preparation

- Live homepage HTTP 200; successful public VM deployment.
- Production: 37 users, 3 series, 0 events/media, 0 cleanup entries/reservations.
- Startup guards require the Production database fingerprint, EU endpoint,
  `vco-content-media`, Standard and Production-only credential selection.
- Cloudflare bucket publicity and actual token scope cannot be independently
  certified from the app or workspace secret inventory. Operator must check
  both in Cloudflare. Real bucket access remains for the approved test.

## Execution after explicit approval

1. **Prepare while uploads are closed.** Operator confirms Cloudflare token
   read/write/delete permissions are restricted to `vco-content-media`; public
   r2.dev/custom-domain access is disabled. Select existing approved admin,
   Creator and non-admin test accounts; no signup, role/password changes or
   credentials in chat. Prepare one neutral JPEG <=512 KiB and one 2–5 second
   MP4 <=2 MiB, with local SHA-256. Recheck baseline jobs/cleanup/reservations.

2. **Restrict access first (recommended).** Because the global flag authorizes
   every otherwise eligible user, operator should make the deployment private
   and restrict platform access to test operators BEFORE enabling uploads.
   Apply/publish that restriction as required and verify it actually blocks
   ordinary visitors. Private-platform access must be available to the test
   operator; API automation may need a fresh external-access token after each
   publish, entered only through Secrets, never chat or URL parameters.
   Do not change application users/roles. If remaining public, explicitly accept
   the concurrent-user upload risk; a short window cannot eliminate it.

3. **Create isolated test galleries.** While the flag is still false, create
   one new draft Creator photo gallery and one new draft official video event.
   Record their IDs; do not attach an existing series, import a folder or edit
   existing content. Verify an otherwise valid normal upload is denied at the
   gate, not merely because a nonexistent event returned 404.

4. **Open the bounded upload phase manually.** In Publishing > Adjust settings >
   Production app secrets/environment variables, change ONLY
   `MEDIA_STORAGE_NEW_UPLOADS_ENABLED` from `false` to `true` and republish.
   Leave database-copy UNCHECKED, the existing database, all R2 target/routing/
   credential flags and the isolated Production startup command unchanged.
   Verify the new deployment is healthy; upload exactly the photo and video
   through the existing app using the appropriate accounts. Record media IDs,
   source/preview keys and any replacement-poster key. Four initial objects,
   maximum five test-owned objects. Never retry a lost upload response blindly.

5. **Close BEFORE delivery tests, including on upload failure.** Immediately
   after the two upload responses, or on any error, operator saves the flag back
   to `false` and clicks Republish. Do not wait for later verification or AI.
   Saving the setting alone does NOT close the currently running application.
   Confirm the replacement runtime is healthy and normal upload is denied.
   If the closing publish fails, keep platform access restricted and retry
   closure; do not reopen public access or continue uploading.
   The operator must be present and ready to perform this closing publish.

6. **Verify with uploads closed.** Read only the manifest-owned media:
   - `provider=r2`, verified catalog state, exact event/owner/source/preview
     associations, MIME/size/SHA-256/object versions; no Replit fallback.
   - Cloudflare object listing/metadata for these exact keys confirms their
     presence in `vco-content-media`. No Production secret is copied to the
     Development shell to perform a separate S3 probe.
   - Authenticated original-file downloads match hashes; image preview and
     current video poster decode. Browser playback advances. Full video GET and
     zero-offset/nonzero/suffix HTTP ranges have correct 206 bytes and headers;
     unsatisfiable ranges are handled correctly.
   - Anonymous originals and non-owner draft access are denied; authorized
     owner/admin access succeeds. Private platform rejection alone is not an
     application-permission PASS. Check unsigned object access is denied too.
   - Public-gallery download-button/statistics workflows are not claimed tested
     by private draft retrieval; do not publish test content just to claim PASS.
   Initial poster generation is part of the upload response. Late AI poster
   replacement can be blocked by closure: record that separately, refresh media
   metadata and do not reopen uploads merely for a background job.

7. **Delete only test data after successful verification.** Wait for test jobs
   and reservations to settle; confirm every pending cleanup item is test-owned
   and no unexpected object/reference exists. Existing media/gallery deletion
   automatically starts general queued cleanup, so it cannot be assumed
   intrinsically exact-key-only. Proceed only with an exclusively test-owned
   queue. Otherwise stop and report; do not force cleanup or introduce code.
   Delete only recorded new media IDs, then only the two new empty galleries,
   using existing application controls. Verify the exact R2 objects are actually
   gone and cleanup/reservations are empty. Never issue bucket/prefix deletion,
   broad admin cleanup, old cleanup SQL or deletion of existing records.
   On a verification failure, close uploads immediately but retain and report
   isolated draft test data until its deletion is separately approved.

8. **Final report.** Confirm HTTP 200, runtime gate false, unchanged protected
   users/roles/series/settings, no remaining test galleries/media/objects, and
   actual measured results versus deferred checks. Restoring public visibility
   or enabling general uploads is a separate operator decision.

## Exposure warning

On a public deployment, every eligible Creator/admin can upload from the moment
the `true` deployment starts serving until the `false` deployment takes over.
The closing republish can take minutes and might fail; this is not an
instantaneous toggle or an automatic guaranteed rollback. Restrict platform
access beforehand, prepare fixtures/actors/IDs first, perform only the two
uploads, and have the operator immediately publish closure. No new application
authorization feature is being proposed.
