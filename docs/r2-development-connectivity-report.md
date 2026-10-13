# First real Development R2 connectivity test

Read-only follow-up: [r2-anonymous-access-investigation.md](r2-anonymous-access-investigation.md).
The confirmed defect is the public-access test design: an unsigned S3 request
does not verify independent `r2.dev`/custom-domain privacy. The precise server-side
reason for HTTP 400 remains unknown because the response body was not retained.
No further live request was made to investigate it.

Date: 13 October 2026 (Europe/Berlin); actual probe start `2026-10-12T23:52:25.583Z`.
Scope: only `vco-content-media-dev`. Operator explicitly authorized one temporary
object test after configuration was corrected. No existing media migration.

## Results

**Authenticated Development connectivity and integrity: PASS.**
On 13 October 2026 the operator confirmed these results and completion of the
manual Development bucket configuration review. This is manual settings evidence,
not an automated Cloudflare account/API audit.

The original probe's aggregate FAIL remains in the historical raw report. It was
caused by an **invalid public-access verification method**: an unsigned S3 API
request cannot establish the privacy of independent public delivery surfaces.
HTTP 400 is not evidence of public exposure, nor a confirmed access-control denial.

| Check | Result |
|---|---|
| Fresh Development process, nine required settings | PASS |
| Development credentials available; Production credential names absent | PASS |
| EU-specific S3 endpoint validation | PASS, configuration check |
| Active configured provider / media routing | `replit` / `disabled`, unchanged |
| Conditional upload of one new temporary WebP | PASS |
| Actual read-back with version-pinned GET | PASS |
| SHA-256 and byte length | PASS, 144 bytes |
| Unsigned request to the known existing object's S3 URL | HTTP **400**; invalid method for verifying public access; diagnostic only |
| Delete only the probe's key; subsequent HEAD confirms absence | PASS |
| Cloudflare EU/Standard/private/public-domain configuration review | **Complete, operator-confirmed manual review**; no account API called |

Probe key: `thumb-45b4c870-d739-45fa-bd6d-b8005ecd3503.webp`.
It is now absent. No second live object or live repeat was created.
Source and downloaded SHA-256:
`8d475bc67489d9d3735ac67a2bf7a27bfac2e7d6999b6e3b77a69216bc473252`.

The first probe did not retain the anonymous response body. HTTP 400 might be
Cloudflare's rejection of an unsigned S3 request, but the observed status alone
does not establish the exact authentication error. Do not silently relax the
denial check or retrospectively mark it PASS. A diagnostic repeat, if separately
approved, should capture a bounded error response/code from the known existing
temporary object before cleanup, without logging credentials or raw provider errors.
The status field in the generated JSON was corrected from `NOT RUN` to `FAIL`
because that request did run and returned HTTP 400; no observation was changed.

## Isolation and side-effect boundaries

- Process was not a published runtime and used explicit Development scope.
- The probe rejects Production scope, Production credential names in its process,
  other buckets, active R2 default storage, enabled routing, or missing isolation
  attestations before constructing a store or making a request.
- Only explicit `R2_DEV_ACCESS_KEY_ID` / `R2_DEV_SECRET_ACCESS_KEY` are selected.
  Their values were not logged. No audit or account-wide token is read by this probe.
- No Production bucket or Production credential was used. No Production database,
  Production media, existing media objects, Worker, domain or deployment was accessed
  or modified by the probe.
- No database client is imported or used by the object-only probe. No provider
  switch, routing enablement, database change, bucket creation/configuration change
  or media inventory/copy run was performed.
- One random-payload WebP under one UUID key was created; conditional create prevents
  overwriting an existing key. Cleanup targets that key only, never lists/empties a
  bucket, and confirms absence.
- Bucket-only IAM scope is based on operator review/attestation, not an account-wide
  permission query or an attempted Production request. Namespace and runtime guards
  were verified without Production access.

## Verification of the implementation

TypeScript check passed. Isolated R2 regression suite passed **11/11**, using
synthetic credentials, injected mock transports and a disposable local PostgreSQL
fixture for migration/routing tests. Those fixtures are not an additional real R2
pilot and do not access the workspace/Production database or existing media.

Machine-readable live evidence: `generated-artifacts/r2/preflight.json`.
Account-wide audit mode was removed from this preflight after the operator selected
bucket-only credentials. A real run requires the explicit approval flag:

```sh
NODE_ENV=development npm run r2:preflight -- --approved-development-connectivity
```

Do not run this again without approval. The flag is an operational confirmation,
not an authorization mechanism for users of the production application.

## Blockers before any real Development media pilot

See [the current pilot readiness report](r2-development-pilot-readiness.md).
Connectivity and operator-confirmed manual settings review are complete; repeating
the invalid unsigned-S3 privacy test is not a pilot prerequisite. Source isolation,
an eligible restricted fixture, target database pins/schema, and a copy-only path
that does not activate mappings remain prerequisites. Pilot execution and any
routing change require separate explicit approval.

Production remains a separate approval, configuration, migration and rollout
decision. Production credentials/settings were not changed.
