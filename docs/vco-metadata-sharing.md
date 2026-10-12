# VCO metadata and sharing

## Final standard copy

- Title: **VCO Media Database | Sim Racing Photos & Videos**
- Description: **Explore official VCO sim racing photos and videos, discover event galleries and browse photography from community creators.**
- Site name: **VCO Media Database**

Recent events, upcoming schedules, archive events, community galleries, individual
events, photos, videos and creator profiles have separate English descriptions.
Nonempty manual descriptions, captions, biographies and credits are used without
changing their stored values. Upcoming event fallbacks describe schedules and
future media availability, not an already populated gallery. Videos retain their
existing noindex rule and use video wording rather than photo wording.

## Runtime assets

All assets live in `client/public/brand` and are copied to `dist/public/brand` by
the existing Vite build:

- `favicon.ico`: 16/32/48px entries.
- `vco-icon-16.png`, `vco-icon-32.png`, `vco-icon-48.png`: official white wordmark,
  cropped to maximize its width on a dark square backing.
- `apple-touch-icon.png`: 180px.
- `icon-192.png`, `icon-512.png`: larger bookmark/app icons, not a PWA claim.
- `vco-social.jpg`: 1200 × 630 JPEG, official white logo, anthracite background,
  condensed product name and restrained racing-blue rules. Essential content is
  inside the central 630px square crop.
- `vco-logo-white.png`, `vco-logo-dark.png`: transparent cropped official logo
  variants. Organization structured data uses the dark variant on light surfaces.

Regenerate with `node scripts/generate-vco-branding.mjs`. The generator uses the
provided official logo and existing local fonts; no AI-generated replacement logo.
The icons and theme color are global head elements, not route-owned metadata.

## Preview and navigation boundaries

Gallery previews come from the existing bounded public image reader, and media
previews require the existing publication and premium checks. Only guarded
thumbnail endpoints are allowed. No original, internal storage URL, private
profile avatar or cover image is introduced into sharing tags. Profiles and
pages without a suitable preview use the branded image.

All absolute metadata URLs use the existing validated `PUBLIC_SITE_URL`, never
the request Host header. Without that origin, image URLs and canonical links
are omitted and indexing stays disabled. Known image dimensions are included
only for the branded JPEG; guarded WebP paths have a known MIME type but no
assumed dimensions. Legacy thumbnails have neither an assumed MIME type nor size.

React preserves direct-load metadata and replaces the same server-owned tags on
navigation, including query changes and history. Previous titles, descriptions,
images and canonicals are removed while loading. Fetch failure leaves a generic
unavailable title and noindex without old page data. Real 404 responses supply
not-found text and the safe brand fallback. Icons remain untouched.

## Verification and open live checks

Local checks cover TypeScript, production build, server-rendered metadata,
escaping, publication gates, assets, actual nested URLs through development and
production fallback handlers, and the built React app's startup/navigation,
history, filters, rapid requests, failures and 404s. The social card and small
icons were inspected visually.

**Still open after an independently approved publication:**

1. Verify the actual public origin and anonymous crawler access. The intended
   domain is not proof of live assignment; no production settings were changed.
2. Fetch the published icon/social files and representative guarded previews
   anonymously, and inspect raw and rendered metadata for each public route type.
3. Check actual mobile saved-bookmark icons and social-platform crop/caching
   behavior, using the operator's approved live URLs.
4. Recheck Google/social crawler results after their caches refresh. Existing
   browser bookmarks and external previews may retain older icons/images.

See `docs/search-visibility-launch.md` for launch prerequisites. No publication,
DNS change, new indexing area, licence promise or legal text change is included.
Google and social platforms may rewrite titles/descriptions and cache previews.
Specific presentation, indexing and rankings are not guaranteed.
