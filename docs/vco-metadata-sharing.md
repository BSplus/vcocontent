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

Gallery previews prefer the selected custom thumbnail, then cover image. Managed
photo references must still belong to this event, have a current safe state and
be anonymously public and non-premium. Selection is independent of the page
currently open in the gallery, so a chosen photo outside the first page wins.
Without a suitable selected image, the first eligible public photo from the
bounded discovery reader is used, then the VCO branded image.

`server/sharing-selection.ts` is shared by the metadata renderer and the native
sharing descriptor (`GET /api/sharing/:kind/:id`). It never accepts a session as
permission to select a private image. Chosen event images use the existing
thumbnail route with `direct=1&public=1`; this mode requires public authorization
even for managers. Media cards and native photo/video-poster handoffs use
`GET /api/sharing/media/:id/image`, which rechecks event publication, premium
status, archive status and current media safety on every request, before cached
delivery or conditional responses. Existing normalized historical thumbnails and
prepared posters are WebP. No original, internal storage URL, private profile
avatar or cover image is introduced into sharing tags. Profiles retain their
safe link/brand-only sharing behavior.

All absolute metadata URLs use the existing validated `PUBLIC_SITE_URL`, never
the request Host header. Without that origin, image URLs and canonical links
are omitted and indexing stays disabled. Known image dimensions are included
only for the branded JPEG; guarded normalized previews have a known WebP MIME
type but no assumed dimensions. Trusted static event image types follow their
validated extension; no dimensions are invented.

React preserves direct-load metadata and replaces the same server-owned tags on
navigation, including query changes and history. Previous titles, descriptions,
images and canonicals are removed while loading. Fetch failure leaves a generic
unavailable title and noindex without old page data. Real 404 responses supply
not-found text and the safe brand fallback. Icons remain untouched.

## Native image sharing

Media-detail pages, home previews, the shared media-grid previews (including
search and creator pages) and event galleries offer **Share image…**. Public
photo previews, video posters and selected gallery thumbnails are eligible;
originals, RAW files and video files are never handed to another app.

Preparation is an explicit action. The browser checks file-sharing capability,
requests the descriptor and image without session credentials, accepts only
same-origin preview addresses and JPEG/PNG/WebP/GIF responses, limits image
bytes to 5 MiB, verifies decoding, and aborts preparation after 12 seconds.
The prepared file expires after 60 seconds or on context change/close.
An explicit ready **Share image…** button invokes `navigator.share` synchronously
from a fresh user click, preserving the user activation needed on mobile.
Repeated preparation/handoff clicks are locked while pending.

The file carries its actual response MIME/extension. The handoff includes title,
existing image-author credits (never a Creator-profile substitute), source text
and source URL. The receiving app decides which fields it retains and whether
the image can be used for a post/story/message. A resolved share promise is
described only as a handoff, not a confirmed publication. Cancellation is a
normal status, not an error alarm. Unsupported devices, incompatible actual files,
timeouts, invalid images and failed preparation remain explicit; none silently
opens a link or starts a download.

X, Facebook and LinkedIn remain link intents; no unsupported image parameters
are appended. Their previews depend on crawler access and platform caches.
Instagram uses the device chooser only when native file sharing is supported;
the app cannot force Instagram to appear or choose a feed/story target.
Otherwise the English guidance explains saving through an existing **permitted**
download option and selecting that image manually in Instagram. Download
availability, accounting, quotas, original-file protection and reuse rights are
unchanged. No posting integrations, accounts, OAuth or automatic posts are added.

No JPEG derivative was introduced: local decoding and mocked handoff checks do
not demonstrate a target-app WebP incompatibility. If a real supported target
rejects these previews, capture that evidence before adding a bounded,
authorized format derivative. A public image already received by a browser or
external platform cannot be retroactively removed from its memory/cache; server
authorization is rechecked on subsequent requests, not on bytes already handed
to another app.

Focused checks:

```
npm run check
npm run build
node --import tsx --test --test-concurrency=1 tests/image-sharing-server.test.mjs tests/seo-sharing.test.mjs tests/seo-metadata.test.mjs tests/seo-discovery.test.mjs tests/event-gallery-thumbnails.test.mjs tests/event-thumbnails.test.mjs
node --import tsx --test tests/image-sharing-ui.test.mjs
```

The browser checks use synthetic API fixtures and mocked `share`/`canShare`;
they inspect actual file bytes, MIME, selected context, title/credits/source,
photo/video/gallery and home/grid entry points, unsupported and incompatible
files, load/format/size failures, cancellation, synchronous failure and duplicate
clicks. They do not assert that Instagram or any other real app received a post.

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
