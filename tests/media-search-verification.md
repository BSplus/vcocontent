# Public caption search verification

## Reported case and access limits

Read-only checks on 11 October 2026:

- The development public search `/api/media?q=MAHLE&fields=caption` returns two older records, IDs 105 (event 2) and 104 (event 8), each with caption `MAHLE`.
- Those same saved captions are present in their public event-gallery responses. The development public event list contains 23 events and no title containing IMSA or 2026. It therefore cannot confirm the reported `IMSA ESPORTS GLOBAL CHAMPIONSHIP 2026, ROUND 2` case.
- Deployment metadata identifies `https://vco-content-studio.replit.app` as a private deployment. Anonymous requests return HTTP 307 to Replit's access gate. Using the existing external access token only in same-origin request headers permitted read-only inspection without changing application authentication or visibility.
- The live public event API contains event 224, `IMSA Esports Global Championship 2026, Round 2`. The live caption-only search returns media 656 from that event with `MAHLE RACING TEAM` in its saved caption. The default search returns eight event-224 records; seven match other metadata rather than that caption phrase. These are legitimate differences between selected search fields.
- Media 656 is absent from both the first unfiltered global media page and the first event-gallery page (each 48 records). The direct published search link `/search?q=MAHLE&fields=caption` displays one media card. Starting at `/search?fields=caption` and typing `MAHLE` without submission leaves the URL without `q`, displays zero cards and says `0 matching media items`. This reproduces the actual reported architecture failure with accessible live data, not just the older local records.
- No extra saved-caption or public-eligibility problem was observed for media 656. This does not assert that every other image in the event contains the phrase or is publicly eligible.
- No production data was changed and no publication was initiated. The production browser inspection verifies the **old** published behavior; the new behavior is verified in preview with isolated fixtures.

## Isolated regression checks

Run the real API/database test without touching either connected database:

```sh
node scripts/test-image-downloads.mjs tests/media-search-api.test.mjs
```

The existing disposable PostgreSQL runner creates a current schema, routes the Neon driver to loopback, and destroys the database afterwards. The test refuses to seed a connected database: without the runner's local proxy flag it is skipped.

The fixture creates an older image and video with exactly `MAHLE RACING TEAM`, then 60 newer unrelated images. The real API must find the older caption-only hits before pagination, with case-insensitive AND-word matching. It also checks media type, selected/empty fields, default fields, disjoint result pages, API input validation and unchanged stored captions. It excludes hidden/premium events, premium media, draft/review creator galleries, review/outdated-approval creator media; legacy published creator content retains its existing eligibility. The public search has the same boundaries for anonymous, owner and admin identities.

Run browser checks against the preview:

```sh
node --import tsx --test tests/search-params.test.mjs
node --test tests/media-search-browser.test.mjs tests/ui-click-targets.test.mjs
```

Browser tests intercept API traffic; they write no media or user data. Sixty media fixtures reproduce a caption-only hit beyond the initial 48. Checks cover typing without submission, 350 ms debounce, history replacement, Enter, search button, direct links, mixed case, multiple words, field disabling/re-enabling, media type, pagination, page reset, Back/Forward, usable input during loading, an obsolete delayed response, explicit API failure/retry and a real empty result. The existing desktop/touch click-target checks use server-filtered fixtures rather than relying on the removed browser filter.

The result count explicitly describes **items on the current page**, not a total. Without total/has-next metadata, a full page permits Next; an empty final page states that there are no more items and permits Previous.
