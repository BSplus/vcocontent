# Public support form

The English `/support` page is public. General VCO contact links, the shared
media-rights notice and the restriction-objection reference use it. Legal contact
addresses in Imprint and Privacy Policy, the separate privacy address and Creator
contact addresses remain unchanged. Route-specific metadata is provided by the
existing server SEO mechanism; the page follows the site's existing noindex
policy for utility pages.

## Delivery and boundaries

- `POST /api/support` requires same-origin JSON. Its parser limit is 24 KiB.
- Shared strict validation limits name to 100, email to 254, subject to 150 and
  message to 5000 characters. Unknown fields are rejected. Header fields exclude
  line breaks and control characters. HTML content is escaped.
- The destination is always `info@vco-esports.com`; `RESEND_FROM` stays
  server-owned. Only the validated visitor email becomes Resend `reply_to`.
- The shared CID-logo HTML layout and text alternative are reused. Existing
  verification/transactional callers do not acquire a Reply-To or new response
  requirement. Support requires a successful provider response with a message ID.
- Existing mail configuration and `SESSION_SECRET` must be available. No new
  secrets, DNS, production configuration, migrations or providers were introduced.
- No visitor auto-response, attachments from visitors, tickets, marketing,
  stored message content or notification-outbox entries are created. Resend and
  the receiving mailbox necessarily process the submitted message.

## Abuse and duplicate protection

The existing `beta_rate_limits` table also holds support-only HMAC identifiers,
payload fingerprints, counts and expiry times. Raw IP addresses and submitted
message fields are not stored in it or logged by support handlers.

Per-IP limits are 3 requests per hour and 10 per day; global budgets are 30 per
hour and 100 per day. These conservative launch budgets count attempted provider
submissions, not just successes, and are fixed-window buckets beginning with the
first reservation. PostgreSQL transaction/advisory locking reserves all four
budgets and the 24-hour request ledger atomically across server instances.
Statement/lock timeouts bound database work; failures roll back and prohibit
delivery. A honeypot is excluded from the tab order and accessibility tree.
No external CAPTCHA, tracking cookie or bot service is involved.

A UUID identifies each explicit submission. The provider idempotency key is a
bounded server-derived HMAC of that UUID. A replay cannot send again within the
24-hour application protection window; only a confirmed accepted request with a
matching content fingerprint can return accepted on replay. Changed content
under the same UUID is uncertain, never falsely accepted. Expired records are
removed during successful subsequent reservations; expiry is not a guarantee of
immediate deletion. Key rotation changes HMAC namespaces and therefore requires
careful operational handling of open windows.

## User-visible outcomes

The UI bypasses both the retrying API helper and mutation defaults. It performs
one bounded fetch per explicit attempt and blocks concurrent clicks synchronously.

- **Accepted:** provider returned successful acceptance with an ID. This is not
  proof of inbox delivery. Further submissions from this form instance are blocked.
- **Validation:** field errors or invalid/oversized JSON; draft remains.
- **Unavailable:** configuration or protection/preflight failure; no mail sent.
- **Rate limited:** persistent IP/global budget exhausted; draft remains.
- **Rejected:** definite provider refusal; an explicit new attempt is possible.
- **Uncertain:** transport timeout/error, malformed acceptance, provider 5xx,
  idempotency conflict or lost client response. Preserve the draft, warn that mail
  might have been sent, and block blind resubmission. Check with VCO first.

Successful provider acceptance is not changed into a failure if subsequent
ledger bookkeeping fails. No raw provider error body is returned or logged.

## Automated verification

```sh
node scripts/test-image-downloads.mjs --enable-uploads tests/support.test.mjs tests/public-beta.test.mjs
node --import tsx --test --test-concurrency=1 tests/support-browser.test.mjs tests/legal-pages.test.mjs tests/email-template.test.mjs tests/transactional-templates.test.mjs
npm run check
npm run build
```

These checks passed on 14 October 2026. Database tests use disposable local
PostgreSQL, synthetic credentials and a mocked Resend transport; `--enable-uploads`
is required by the existing public-beta regression fixtures, not the support
feature. Browser tests intercept the support endpoint before it reaches the
server and check draft retention, all outcome classes, double-click guards,
keyboard submission, public navigation, and widths 320/390/1280.
The mobile rendered support page was also visually inspected. No real mail was sent.
Build warnings about bundle size, Browserslist age and the existing Node/AWS
support notice are unrelated to support.

## Separately authorised operational check

After an explicit operator approval, send one clearly labelled enquiry through
the intended deployed form. Confirm that `info@vco-esports.com` received it, the
display/HTML/text are correct, and Reply targets the test visitor address rather
than the configured From address. Confirm only one message arrives. Provider
acceptance alone does not satisfy this inbox test. No such mail or publication
has been performed for this implementation; legal/provider retention approval
and deployment remain operator steps.
