# Read-only investigation of anonymous HTTP 400

Date: 13 October 2026. This investigation reads the existing implementation,
saved test report and public Cloudflare documentation only. **No new live R2
request, object, bucket setting change, provider switch or deployment was performed.**

## Findings

### 1. Exact request type

The anonymous call was a server-side Node `fetch` GET:

```text
https://<account-id>.eu.r2.cloudflarestorage.com/vco-content-media-dev/<owned-probe-key>
```

This is the **EU S3 API endpoint**, with the bucket in the path. It is not:

- the Cloudflare REST management API;
- an `r2.dev` public development URL;
- a custom-domain public bucket URL;
- an application/Worker preview or download route;
- a presigned URL.

The key was known to exist when this call was made: authenticated, version-pinned
GET and SHA-256 verification had just succeeded. Cleanup occurred afterwards and
confirmed its absence. Testing that deleted key now would not establish access
control for an existing object.

### 2. What caused HTTP 400?

**Confirmed test-design cause:** the preflight tested public access against the S3
API surface and interpreted its HTTP status as if it proved bucket privacy. That
is not a reliable inference. The implementation also accepted only 401/403/404,
so HTTP 400 caused the aggregate probe to fail despite working authenticated
upload/read/checksum/cleanup.

**Exact Cloudflare reason for HTTP 400: not recoverable from retained evidence.**
The code saved the status and then cancelled the response body. It retained
neither Cloudflare's XML `<Code>`/`<Message>` nor response headers. Cloudflare's
documented S3 errors are distinguished by XML codes, not status alone; HTTP 400
can indicate different request-validation errors.

| Explanation | Evidence and conclusion |
|---|---|
| Incorrect EU endpoint or nonexistent bucket | Not supported: the configured EU endpoint and same bucket/key worked through the authenticated S3 client. |
| Malformed URL/key | No obvious defect: fixed bucket, simple UUID/WebP key, no userinfo or query string, and path-style bucket addressing matching the configured client. Actual wire requests were not captured. |
| Missing S3 authentication/protocol requirements | Plausible: the S3 API authenticates using AWS SigV4, which this call intentionally omitted. The exact returned XML error was not retained, so this is not a proven server-side diagnosis. |
| Confirmed bucket access-control denial | Not established by the saved HTTP 400 alone. It must not be retrospectively relabelled as a confirmed `AccessDenied`. |
| Browser CORS failure | Not applicable to this Node server-side fetch; this was not a browser request/preflight. |

The original aggregate FAIL remains historical evidence. The authenticated S3
connectivity and integrity checks were PASS. On 13 October 2026 the operator
confirmed completion of the manual Development bucket configuration review.
The unsigned S3 request is classified as an invalid public-access verification
method, not evidence that the bucket is public. No response or raw observation
has been rewritten.

### 3. Authentication headers

At implementation level the anonymous call supplies only `redirect: "manual"`
and a timeout signal. It supplies **no Authorization, Cookie, API-token header,
S3 security-token header or presigned query parameters**. It uses ordinary Node
`fetch`, not the authenticated S3 client's `send`. The CLI does not override the
anonymous fetch function. The inspected probe/import path does not install a
global credential-injecting fetch wrapper.

Authenticated upload/GET credentials are provided separately to the S3 client;
the client does not attach them to this plain fetch call. Thus there is no code
path intentionally or accidentally forwarding those credentials here. Raw
transmitted headers were not logged, so this is a code-level verification rather
than a retrospective packet capture.

### 4. Suitability for a private EU bucket

The EU endpoint is correct for **authenticated S3 object operations** and can be
used for an optional diagnostic of unsigned S3 behaviour.

It is **not sufficient for proving that public bucket access is disabled**.
Cloudflare exposes public buckets through `r2.dev` and/or custom domains.
These surfaces are independent of one another and of S3 API authentication.
An unsigned S3 rejection would not rule out an enabled public domain.

Likewise, merely obtaining 404 from an unknown/nonexistent URL or after deleting
the probe would not prove denial for an existing object.

## Proposed correction — not executed or implemented by this investigation

Separate three results instead of merging them into one anonymous status gate:

1. **Authenticated S3 connectivity/integrity:** already PASS, including confirmed
   cleanup. Do not repeat just to recover this evidence.
2. **S3 unsigned-request diagnostic:** optional. If authorized later, capture a
   small bounded error response while a known test object exists. Parse only
   allowlisted/sanitized error codes and safe response metadata; do not log
   credentials or raw reflected provider errors. HTTP 400 must not become an
   unconditional PASS. This diagnostic still cannot prove public-domain privacy.
3. **Public access disabled:** inspect the authoritative Development bucket
   settings, using the operator-selected **manual dashboard review**, not an
   account-wide audit token:
   - exact Development bucket and EU jurisdiction, not just a location hint;
   - Standard storage class;
   - Public Development URL disabled / public URL access not allowed;
   - every attached custom domain disabled / access to bucket not allowed,
     or no custom domains attached;
   - separately identify any Worker/application binding that can expose content.
     A private bucket does not by itself prove a bound application's permissions.

Record settings evidence and time as **manual verification**, not API verification.
Do not enable public access just to create a URL for testing, guess a `pub-*` URL,
or use presigned URLs for an anonymous privacy test.

If independent black-box public-surface verification is desired and separately
approved, use the **actual known `r2.dev`/custom-domain URL(s)**, no cookies,
Authorization, Access tokens or signing parameters, and a uniquely owned object
whose existence and SHA-256 are verified by authenticated S3 immediately before
the public GET. Follow no unapproved redirects, reject delivery of the object
bytes, distinguish denial from malformed requests, and clean up only that object.
If no public URL/surface exists, record that configuration fact rather than
inventing a URL and claiming its 404 proves privacy. Previously public caches and
any Worker routes require their own scoped revocation review, not a blanket
private-bucket assertion.

## Is another live test necessary?

- **No** to establish the successful S3 upload/read/SHA/cleanup already observed.
- **No** to identify the test-design problem or review privacy settings manually.
- **Only if explicitly desired and approved** to recover a precise response error
  from a new S3 diagnostic or independently test real public URLs with a known
  existing test object. The old response body cannot be recovered without new
  evidence, and its deleted key is not a valid positive control.

Update: the operator has completed the Development-only manual settings review.
Do not automatically repeat the old unsigned S3 test. No further live test is
authorized by this investigation.

## Sources and implementation evidence

Public documentation consulted 13 October 2026:

- https://developers.cloudflare.com/r2/api/tokens/ — jurisdiction-specific endpoints
  and account versus bucket-scoped permissions.
- https://developers.cloudflare.com/r2/platform/troubleshooting/ — S3 SigV4 and
  distinction from the Cloudflare REST API.
- https://developers.cloudflare.com/r2/api/error-codes/ — XML S3 errors and status/code distinctions.
- https://developers.cloudflare.com/r2/buckets/public-buckets/ — independent
  `r2.dev` and custom-domain public access.

Local evidence: `server/r2-development-probe.ts`, `server/object-store.ts`,
`scripts/r2-preflight.mjs`, `generated-artifacts/r2/preflight.json` and
`docs/r2-development-connectivity-report.md`. No existing observation was changed
by this read-only investigation.
