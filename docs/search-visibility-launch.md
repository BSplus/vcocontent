# VCO SEO / GEO launch checklist

## Current release boundary

The operator's intended public domain is **https://content.vco-esports.com**.
It is not assumed to be connected, live, or authorised for a public launch.
The implementation does not change DNS, deployment visibility, production
   environment variables, database schema, original files or reuse rights.

Read-only deployment checks during this work found a private VM deployment at
https://vco-content-studio.replit.app, no associated additional domain and no
production `PUBLIC_SITE_URL`. These are launch prerequisites, **not completed
launch actions**. Recheck them at launch; this is not a permanent status report.

## Operator actions — OPEN

1. Approve public access to the intended public pages. Studio, accounts, admin,
   original-file downloads and content moderation must retain their existing
   protections. A private deployment's front-door authentication cannot be
   overcome by an app sitemap.
2. Add and verify the custom domain through Publishing settings. Apply exactly
   the DNS records supplied there, then confirm DNS, HTTPS and a valid certificate.
   Do not infer domain activation from its intended name.
3. Only after confirming that domain, set production `PUBLIC_SITE_URL` to
   `https://content.vco-esports.com` (trusted HTTPS root origin only; no credentials,
   path, query or fragment). The default remains `noindex` and robots disallow all
   when the variable is missing or invalid. Do not set the production origin in
   development merely to make its preview indexable.
   Known `.replit.dev` preview origins and localhost are rejected by the SEO
   origin validator even if an existing verification configuration uses them.
4. Optional: if the old published origin should permanently redirect HTML
   navigation, set `PUBLIC_PREVIOUS_SITE_URL` to that independently verified HTTPS
   root origin. This opt-in sends 301 redirects only for GET/HEAD HTML fallback
   requests from that exact old host over HTTPS. API and static resources are
   unchanged. Do not redirect an unverified host or use request headers as the
   destination. Test both origins, query preservation and absence of loops.
5. Publish the approved release and approved access settings. This checklist
   does not grant permission to publish or remove the private deployment gate.
6. With no login/session, inspect raw HTML for homepage, each event index, an
   active creator, a published gallery and a photo. Confirm meaningful content,
   preview image, canonical URL, index directive, JSON-LD and valid status codes.
   Confirm hidden/draft/rejected/suspended/quarantined/premium content remains
   excluded and missing public pages respond with 404.
7. Check `/robots.txt`, `/sitemap.xml`, every listed sitemap segment and some
   listed preview URLs. Preview responses must be actual images; originals
   must retain the normal download rules. Confirm no `.replit.dev`, internal
   storage URLs, private contact data or original-file URLs in SEO output.
8. Verify ownership of the domain in Google Search Console (DNS verification
   uses the provider's exact token through its appropriate settings, never chat).
   Submit `https://content.vco-esports.com/sitemap.xml`. Inspect representative
   photo and gallery URLs, rendered HTML, crawl access and canonical selection.
   Use Google's Rich Results Test / Schema Markup Validator for sample pages.
   Bing Webmaster Tools can be added separately with operator access.

## Implementation and efficiency

- Public homepage, date-based indexes, creator galleries, active creator profiles,
  event galleries and eligible images expose public text and links before JS.
  Every visitor gets this HTML; React replaces it with the interactive UI.
  SPA navigation refreshes the same server-owned metadata and fails closed.
- SQL discovery readers select bounded metadata, not original payloads or full
  account profiles. Historical Base64 thumbnails become their protected preview
  endpoint, never inline Base64 in sitemaps.
- Event, creator and per-gallery image sitemap segments contain at most 500
  records. Images must have an allowed public preview. No old silent media-page
  cap is used. An index exceeding the sitemap protocol's 50,000 segment ceiling
  fails explicitly and needs another index level.
- No TTL cache of public records or HTTP HTML/sitemaps: moderation, hiding and
  suspension are checked afresh. Static assets retain their normal serving.
  This chooses freshness over caching until shared invalidation exists.
- No new synchronous AI work, file editing or watermarking occurs on downloads.
  Recognition guesses/tags are not turned into person identities or licences.
- No invented `lastmod`: current data has creation/event dates, not a reliable
  last-public-content-modification timestamp. Event dates are visible to users;
  sitemaps omit `lastmod` rather than claim uploads were last changed then.
- Videos keep their existing availability and are not made indexable or given
  fabricated `VideoObject` metadata. Required verified video facts and suitable
  playback access would need a separate decision.
- Image structured data points to protected public previews, never originals.
  Photographer names are included only when recorded; gallery ownership does
  not identify the physical photographer or driver.
- Filter/search/account/admin/Studio pages are not SEO landing pages. Tracking
  parameters canonicalise to the clean public URL; arbitrary filters receive
  `noindex`. The FAQ makes no reuse or AI-training licence promises.

## Measure after public launch

Record a launch date and compare equivalent periods; results take time:

- Search Console: indexed pages, excluded-page reasons, crawl errors, web and
  image impressions/clicks, queries and landing pages.
- Referrals: traffic from actual publications/source links, not copied-link
  counts claimed as backlinks.
- Downloads: existing download counters show usage, not a direct ranking signal.
  Compare organic visits to downloads rather than manufacture a ranking metric.
- Optional analytics for successful credit/source copies can show adoption, but
  cannot prove a backlink was published. Add only through the supported analytics
  access flow and without sending names, captions, emails or clipboard text.

AI Overviews / AI Mode use Google's existing search eligibility foundations.
Accessible factual content and accurate structured data help discovery; there
is no guaranteed ranking, image-search inclusion or AI citation. `llms.txt` is
not a prerequisite. Crawl access is not a blanket grant of training/reuse rights.

Sources:
- https://developers.google.com/search/docs/appearance/google-images
- https://developers.google.com/search/docs/appearance/ai-features
