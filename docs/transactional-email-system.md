# Transactional email system

## Audit and implemented scope

| Email | Before this change | Current implementation |
| --- | --- | --- |
| Verification | Active Resend send, hashed token, 60-minute expiry, single use | Preserved; shared transport/logo; subject `Verify your email \| VCO` |
| Account welcome | Missing | Queued once after first successful email confirmation |
| Password reset | Missing workflow and email | Branded template prepared; no reset route, UI or token service added |
| Password changed | Missing workflow and email | Branded template prepared; no active trigger |
| Creator welcome | Activation existed; email missing | Queued once after verified self-activation or administrator approval |
| Gallery published | Publication existed; email missing | Queued on confirmed draft-to-public transition; stable gallery key prevents repeats |
| Processing failure | Image/job errors exist, no final actionable upload-batch event | Branded template prepared; deliberately inactive |
| Community notifications | Follows exist, no email preferences | Phase 2 copy specifications below; inactive |
| Payment/earnings notifications | Legacy Credits fields; purchase and Stripe webhook routes disabled in beta | Phase 2 specifications below; no payment data or flows changed |

No separate welcome email is sent at registration, on login, on failed verification,
or on ordinary profile/gallery edits. Creator approval before email confirmation
does not send early; confirmation then queues both applicable welcomes.

The approved CID logo, compact header, two tightly spaced verification headline
lines, blue CTA, responsive CSS, Outlook button markup and plaintext remain.
The latest brief specifies `© Virtual Competition Organisation (VCO) GmbH` once
in the footer. New copy uses British English. Essential action URLs use the trusted
HTTPS root in PUBLIC_SITE_URL. Reset templates require an actual URL and expiry
from a future secure reset implementation; they do not invent a token service.

## Delivery

- `server/email-delivery.ts` reuses the current Resend configuration and small CID PNG.
- `server/email-templates/layout.ts` provides the shared brand frame.
- `server/email-templates/transactional.ts` prepares six new account/Creator templates.
- `server/transactional-emails.ts` is a small persistent outbox drained in the existing
  application process, not another workflow/service or notification framework.
- Transactional keys are unique per user welcome/Creator activation and per gallery.
  Successful-event transactions enqueue through a savepoint; queue insertion faults
  are logged without rolling back the user's confirmed account/gallery change.
- Provider acceptance is recorded as **accepted**, never **delivered**. No delivery
  webhook, read receipt or tracking pixel was introduced.
- The outbox is for non-secret event notifications only. Verification remains a
  direct secure send with only its token hash persisted. Future reset links must
  not be placed into the outbox's plaintext content snapshot.
- Claims use PostgreSQL row leases and SKIP LOCKED. Up to five messages are handled
  per 30-second tick with a 600 ms spacing. Network calls have a 10-second timeout.
- Retries use the same event idempotency key and frozen message/recipient. Payloads
  are removed after acceptance. Attempts stop at four or 23 hours, before the
  provider's 24-hour idempotency window expires. Old/persistent failures need
  operator review; they are not silently retried indefinitely.
- Immediately before sending, verify current account state and public gallery
  visibility. Revoked/suspended access, hidden/draft galleries and changed recipients
  suppress promotion. The gallery title is HTML-escaped and wraps on narrow screens.
- Community limits come from the existing policy: standard 5 galleries, 1,000 photos,
  500 decimal MB; approved exception 10 galleries, 2,000 photos, 1,000 MB. Admin-exempt
  recipients do not receive a false finite-quota claim.
- Existing accounts/galleries are not bulk-notified. For previously unpublished
  galleries without historical publication records, deduplication covers the first
  confirmed transition observed after this feature is introduced.

### Limitations and operational boundaries

If outbox insertion itself fails, the account/gallery operation still succeeds but
that notification requires operator recovery. This deliberately prioritises
working authentication/publication over an email side effect.

No optional email is active, and no preferences dashboard or marketing platform
was built. Optional community notifications require consent/preferences before
activation. Password reset/change needs a separate, securely reviewed application
feature. Processing failures need a persistent, final, user-actionable **batch**
boundary rather than an individual transient image error.

Only the development outbox table/index was added. No production schema, settings,
hosting or publishing changes were made. Review the publish-time database diff
before enabling this code in production. Keep test-send subjects prefixed `[TEST]`;
the real verification template has no test label. Development fixtures mock Resend.
Actual email-client rendering and inbox delivery need separately authorised tests.

## Phase 2: approved copy and inactive template specifications

All use the shared VCO frame, HTML escaping, plaintext and trusted CTA URLs.
The placeholder fields below must come from verified application/provider state,
not client claims. No Phase 2 trigger or send path is connected.

### 08 — New follower
**Subject:** Someone's following your work | VCO  
**Headline:** YOUR AUDIENCE IS GROWING.  
**Body:** [User Display Name] has started following your Creator profile on the VCO Content Database.

Keep sharing your best motorsport photography.

**CTA:** VIEW YOUR PROFILE  
**Destination:** The recipient's actual visible Creator profile.
**Activation gates:** Explicit optional preference; profile privacy; stable follow-event
key; rate cap or digest. Do not emit one email for every repeated follow/unfollow.

### 09 — New gallery from a followed Creator
**Subject:** Fresh shots from [Creator Name] | VCO  
**Headline:** FRESH FROM THE TRACK.  
**Body:** [Creator Name] has published a new gallery:

"[Gallery Name]"

Discover the latest motorsport moments from a Creator you follow.

**CTA:** EXPLORE THE GALLERY  
**Destination:** The actual public gallery page, not a protected file URL.
**Activation gates:** Optional preference/consent, active follow relationship, public
visibility recheck, stable follower/publication key, digest or frequency cap.

### 10 — Credits purchased
**Subject:** Your VCO Credits are ready  
**Headline:** CREDITS LOADED.  
**Body:** Your Credit purchase was successful.

[Purchased Credits] Credits have been added to your VCO account.

Your new available balance is [Current Credit Balance] Credits.

**CTA:** EXPLORE CONTENT  
**Secondary:** Payment reference: [Transaction Reference]  
**Activation gates:** Confirmed provider payment and committed Credit ledger entry;
transaction-based deduplication. Never a client checkout-success screen.

### 11 — Paid photo purchase
**Subject:** Your VCO download is ready  
**Headline:** THE SHOT IS YOURS.  
**Body:** Your purchase is complete.

You've unlocked "[Photo or Gallery Title]" by [Creator Name].

Your purchased content is ready to download.

**CTA:** DOWNLOAD YOUR PHOTO  
**Secondary:** Credits used: [Credit Amount]  
**Destination:** Authenticated purchased-content page; never an unrestricted original
file, signed storage URL or transfer of copyright/exclusive ownership.
**Activation gates:** Recorded purchase and current access entitlement; stable purchase key.

### 12 — Payment receipt
**Subject:** Your VCO payment confirmation  
**Headline:** PAYMENT CONFIRMED.  
**Body:** Thank you for your purchase.

We've received your payment of [Amount] [Currency].

Your transaction details are available in your VCO account.

**CTA:** VIEW TRANSACTION  
**Activation gates:** Confirmed payment; reuse provider receipts where appropriate and
avoid duplicates. Include verified billing details; never invent tax/invoice numbers
or present a payment confirmation as a legally valid invoice.

### 13 — Creator earnings
**Subject:** You've earned Credits on VCO  
**Headline:** YOUR WORK IS PAYING OFF.  
**Body:** Good news!

Your photography has generated new earnings on the VCO Content Database.

New earnings: [Amount]

Available Creator balance: [Balance]

**CTA:** VIEW YOUR EARNINGS  
**Activation gates:** Confirmed accounting event, explicit correct unit/currency,
pending versus available balances, frequency cap. Do not promise payout eligibility.

### 14 — Creator payout
**Subject:** Your VCO payout is on its way  
**Headline:** PAYDAY.  
**Body:** Your Creator payout of [Amount] [Currency] has been initiated.

Thank you for sharing your photography with the VCO community.

**CTA:** VIEW PAYOUT DETAILS  
**Secondary:** Payout reference: [Reference]  
**Activation gates:** Provider-confirmed initiation, stable payout-event key. Initiated
does not mean completed. Failures/reversals need separate handling. Never expose bank details.

### 15 — Payment failed
**Subject:** Action required: VCO payment  
**Headline:** PAYMENT NOT COMPLETED.  
**Body:** We couldn't complete your recent payment.

No additional Credits have been issued for this unsuccessful transaction.

Please review your payment details and try again.

**CTA:** REVIEW PAYMENT  
**Activation gates:** Final provider failure and verified no Credit issuance, not pending
status. No card details or unauthorised automatic payment retries.

## Validation commands

```sh
node scripts/test-image-downloads.mjs tests/public-beta.test.mjs
node --import tsx --test --test-concurrency=1 tests/email-template.test.mjs tests/transactional-templates.test.mjs
npm run check
npm run build
```

The first command uses disposable local PostgreSQL and synthetic provider responses.
Browser previews exercise desktop, 390px and 320px with light/dark preferences,
including long gallery titles. They do not prove native Gmail/Outlook/Apple Mail behaviour.
