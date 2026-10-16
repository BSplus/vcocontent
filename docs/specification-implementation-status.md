# Unified specification — implementation progress

16 October 2026. Scope: the existing seven-phase specification in
`.local/tasks/vco-marketplace-unified-specification.md`. This status is not
authorization for settings, schema, paid services or deployment changes.

## Current position

**Phase 2, package P2-5. Five Phase 2 work packages remain, including P2-5.**
Packages are delivery/acceptance milestones, not a prediction of five edits or
five chat turns. Prepared code and disposable tests do not imply activation.

The recent JPEG recovery, thumbnail reconciliation and diagnostics steps are
parts of **P2-8**, with their bounded-failure evidence in **P2-9**. They do not
replace P2-6 RAW or P2-7 Creator video, and are not additional marketplace phases.
No billing or commercial features have started.

Diagnostics have isolated read-only connection-stall evidence. The next
acceptance slice now exercises actual SIGKILL and fresh-process JPEG recovery
after thumbnail persistence, before registration and after the registration
commit. It checks one asset/analysis admission, immutable bytes, no repeated
provider writes, capacity retention and exact final accounting. See
`docs/native-upload-recovery.md` for the evidence and its limits.
The final native suite passed 49 checks with no failures/skips; type checking
and the production build passed.
This is not whole-worker resource/stall, host-restart or live-provider acceptance.
Next continue the outstanding RAW/video packages within approved
format/resource/policy boundaries; operational release gates remain separate.

| Package | Current position |
| --- | --- |
| P2-1 Ownership | Contracts and regression foundation implemented. |
| P2-2 Asset/object mapping | Additive foundation and compatibility implemented; rollout approvals remain separate. |
| P2-3 Capacity/reservations | Accounting, reservation and usage foundations implemented; existing beta policy retained. |
| P2-4 Immutable JPEG | New-intake source preservation and bounded derivatives implemented. |
| **P2-5 Upload sessions** | **In progress.** Native JPEG is connected to authenticated sessions and the existing uploader behind disabled Development-only gates. Disposable HTTP/client tests and mobile/desktop Studio controls with mocked native responses pass; connected native browser/provider and full operational acceptance remain. |
| P2-6 RAW pairing | Remaining: approved formats, explicit safe pairing and original-delivery controls. |
| P2-7 Creator video | Remaining: policy-gated Creator capability, bounded codec/preview support and end-to-end lifecycle. Existing official video remains unchanged. |
| P2-8 Recovery/integrity | Native-aware deletion, durable cleanup/accounting handoff, bounded JPEG recovery, reserved-thumbnail reconciliation and aggregate Development admin diagnostics are prepared/tested. Remaining: cross-object diagnostics/case resolution, RAW/video lifecycle and operational acceptance. |
| P2-9 Compatibility/release evidence | In progress: isolated HTTP/client/browser, diagnostics connection-stall and three JPEG application-process restart boundaries. Remaining: broader lifecycle/restart/resource measurements and reviewed release/recovery plan. |

## After Phase 2

Five larger phases remain: **3 metadata/AI workflows**, **4 subscriptions**,
**5 marketplace purchases/licences and separate ledgers**, **6 earnings/payouts**,
and **7 controlled release**. Commercial/legal/accounting choices and financial
activation need their own approvals. They are not implemented by storage work.

## Immediate next integration

The gated JPEG finalizer, ordinary thumbnail persistence, independent safety,
single analysis admission and inactive-finalizer resume/cancel/error behavior
have isolated HTTP/DB/client evidence. See `docs/native-jpeg-intake.md`.

Native deletion now has 22 passing native-flow checks, including a 515-object
batched handoff; see `docs/native-asset-deletion.md`. Interactive Creator/Admin
controls now have mobile/desktop native-response coverage, including uncertain
errors, lost commits and refused cancellation; see
`docs/native-upload-browser-acceptance.md`. The existing maintenance timer now
has bounded native-JPEG recovery, held uncertainty, backoff and aggregate
diagnostics; see `docs/native-upload-recovery.md`. Next complete broader lifecycle
and operational evidence before connected Development approval.
The admin Media Management tab now has a read-only, bounded Development sample
with held/retry reasons and sampled reservation bytes; see
`docs/native-upload-diagnostics.md`. It does not invoke recovery or release quota.
Native code uses existing
routes but is not enabled in this workspace or Production. No current limits
were increased; RAW, Creator video, metadata exports and paid features remain off.
