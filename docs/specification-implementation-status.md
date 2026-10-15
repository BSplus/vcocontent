# Unified specification — implementation progress

15 October 2026. Scope: the existing seven-phase specification in
`.local/tasks/vco-marketplace-unified-specification.md`. This status is not
authorization for settings, schema, paid services or deployment changes.

## Current position

**Phase 2, package P2-5. Five Phase 2 work packages remain, including P2-5.**
Packages are delivery/acceptance milestones, not a prediction of five edits or
five chat turns. Prepared code and disposable tests do not imply activation.

| Package | Current position |
| --- | --- |
| P2-1 Ownership | Contracts and regression foundation implemented. |
| P2-2 Asset/object mapping | Additive foundation and compatibility implemented; rollout approvals remain separate. |
| P2-3 Capacity/reservations | Accounting, reservation and usage foundations implemented; existing beta policy retained. |
| P2-4 Immutable JPEG | New-intake source preservation and bounded derivatives implemented. |
| **P2-5 Upload sessions** | **In progress.** Native JPEG is now connected to authenticated sessions and the existing uploader behind disabled Development-only gates. Disposable HTTP/client recovery and regression tests pass; interactive native Studio and full operational acceptance remain. |
| P2-6 RAW pairing | Remaining: approved formats, explicit safe pairing and original-delivery controls. |
| P2-7 Creator video | Remaining: policy-gated Creator capability, bounded codec/preview support and end-to-end lifecycle. Existing official video remains unchanged. |
| P2-8 Recovery/integrity | Remaining: native-aware media/gallery deletion, integrated bounded reconciliation and operational diagnostics. Existing bulk gallery deletion cannot retire the physical inventory; this blocks activation. |
| P2-9 Compatibility/release evidence | Remaining: complete acceptance, resource measurements and reviewed release/recovery plan. |

## After Phase 2

Five larger phases remain: **3 metadata/AI workflows**, **4 subscriptions**,
**5 marketplace purchases/licences and separate ledgers**, **6 earnings/payouts**,
and **7 controlled release**. Commercial/legal/accounting choices and financial
activation need their own approvals. They are not implemented by storage work.

## Immediate next integration

The gated JPEG finalizer, ordinary thumbnail persistence, independent safety,
single analysis admission and inactive-finalizer resume/cancel/error behavior
are now covered by 75 passing disposable tests. See `docs/native-jpeg-intake.md`.

Next close the native lifecycle/deletion blocker and interactive acceptance
before requesting connected Development approval. Native code uses existing
routes but is not enabled in this workspace or Production. No current limits
were increased; RAW, Creator video, metadata exports and paid features remain off.
