# Native asset deletion — prepared, not activated

16 October 2026. Lifecycle portion of P2-8.

## Implemented

Ordinary single-media and gallery deletion now understand the prepared physical
asset inventory. They reuse existing ownership checks and the existing durable
cleanup queue; no new schema, endpoints, upload flags or authorization system
were introduced.

Inside the existing owner/gallery transaction:

1. Refuse deletion that would lose an unfinished native upload or uncleaned
   native staging receipt.
2. Lock existing cleanup entries, routes and inventory in a consistent order.
   Validate actual gallery ownership and verified route size/hash/version.
3. Detach the deleted media's variant links and metadata record.
4. Preserve physical objects still referenced by another media/variant,
   reference document or upload reservation. Refuse whole-gallery deletion if
   those references would leave its physical ownership stranded.
5. Transfer eligible physical keys, authoritative bytes and Creator ownership
   into the durable cleanup queue, then remove inventory and gallery/media
   records in the **same transaction**. No provider operations occur inside
   this logical-deletion transaction.

The existing retained-storage calculation already counts cleanup bytes. Thus
removing a physical inventory row does not imply freeing space. Shared keys
remain counted once, and generated variants outside legacy media URLs are
included. SQL handoff uses set-based reads and batches of at most 512 queued
keys, rather than a round-trip per object or an unbounded parameter list.

Implementation: `server/media-asset-deletion.ts`, ordinary deletion in
`server/storage.ts`, and R2 confirmation in `server/media-object-routing.ts`.

## R2 cleanup confirmation

- The cleanup worker respects current media/document/reservation references.
- For an existing verified R2 object, size, MIME and version must match the
  registered route before deletion. A detected replacement remains charged.
- A successful SDK reply alone does not free space: a subsequent metadata
  lookup must confirm object absence.
- Failure, false-positive acceptance or a lost deletion reply retains the queue
  and its accounting. A later retry can confirm absence without repeating a
  deletion that already succeeded.
- Logical deletion revokes ordinary protected delivery immediately, even while
  physical cleanup is pending.
- The pre-existing Replit SDK deletion contract and retained migration-source
  protections are unchanged. No new RAW formats or RAW intake were enabled;
  their storage/delivery acceptance remains part of P2-6.

This uses immutable application keys and database locks, not an atomic
provider-side conditional delete. It does not promise protection from an
external bucket operator replacing a key between metadata lookup and DELETE.
Real-provider protocol/resource acceptance is still a release gate.

## Verification

Final targeted run:

```sh
node scripts/test-image-downloads.mjs --enable-uploads tests/native-jpeg-intake.test.mjs
npm run check
npm run build
```

**22 Node-reported native-flow tests passed, zero failures/skips.** These include
Creator and official-admin deletion, shared keys, non-URL derivatives,
failed/false-positive/lost delete responses, observed version replacement,
cross-gallery references, incomplete staging, concurrent deletions and a
515-object batched handoff retaining all bytes.

An earlier broader run passed **85 regression tests** outside the native-flow
suite: ownership, asset foundation, capacity, multipart journal, existing
resumable HTTP and browser-client behavior. The final native run followed the
concurrency fix and set-based handoff changes; these counts are from separate
runs, not a claim of one combined 107-test invocation.

Tests use disposable loopback PostgreSQL and synthetic disk-backed R2. The
final fixture also mocks the legacy Replit adapter, including cleanup of
reservations that never acquired a provider route. Large-inventory timing
includes fixture cleanup and is not a hosted performance promise.

## Still not release-ready

The ordinary deletion/inventory blocker is resolved in prepared code and
isolated tests. Native uploads remain disabled. Interactive native mobile and
desktop acceptance, bounded uncertain-upload reconciliation/diagnostics, real
provider/resource evidence and separate activation/schema/publishing approvals
remain outstanding. No connected schema, Production settings or Production data
were changed.
