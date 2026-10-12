# Mobile navigation and gallery rows

## Scope

The smartphone layout applies below 768 CSS pixels. Home, Search, Events and
More are fixed at the bottom; Events opens `/current-events`. More preserves
the existing role checks and account links. The saved account avatar remains
in the header. No backend, login, publication or download policy changed.

Only the existing small homepage collections and a creator's published gallery
list become native horizontal snap rows. Event media and search remain
paginated grids. Row arrows provide an alternative to swiping; single and empty
collections have no row controls. Drag-generated clicks are cancelled.

Photo gestures are bound to the image surface, not the dialog or its actions.
They skip videos; explicit arrows still visit all media. Vertical gestures,
multi-touch and native video controls are not intercepted.

## Checks

Commands against the running preview:

```sh
node --import tsx --test tests/mobile-gallery-ui.test.mjs
node --import tsx --test --test-concurrency=1 \
  tests/navigation-layout-ui.test.mjs tests/ui-click-targets.test.mjs \
  tests/pagination-ui.test.mjs tests/media-search-browser.test.mjs \
  tests/creator-profile-ui.test.mjs
npm run check
npm run build
node --import tsx --test --test-concurrency=1 tests/video-playback.test.mjs
```

The mobile suite uses isolated API fixtures, genuine Chromium touch sequences,
keyboard input, measured CSS viewports, dialog bounds and footer clearance.
It covers row swipes without navigation, drag click suppression, row buttons,
More focus trapping/return, guest/Creator/Admin links, saved avatars, active
Events, keyboard-focus hiding, photo swipes, vertical gestures, skipping videos,
unchanged search/event grids, creator rows, singleton/empty/error/loading states.
The existing suites check pagination counters, filter URLs, browser history,
permissions visible in the UI and profile editing. Video fixtures use real
synthetic H264 decoding, native controls and authenticated streaming handlers.
The video fixture now supplies the requested pagination envelope; array responses
remain available. Reload-based error checks avoid retained media buffers.
Its process-cached bucket mock resolves the active fixture, preventing later
cases from accidentally serving a prior test's objects. All three playback
cases pass together.

Measured layouts:

| CSS width | Header height | Collection layout | Bottom navigation |
| --- | --- | --- | --- |
| 320 | 57 px | horizontal, snap, next card visible | visible |
| 390 | 57 px | horizontal, snap, next card visible | visible |
| 430 | 57 px | horizontal, snap, next card visible | visible |
| 768 | 73 px | existing grid | hidden |
| 1600 | 73 px | existing grid | hidden |

No horizontal page overflow was measured at these widths. Smartphone previews,
details and creator profiles were also measured separately.

## Comparison screenshots

Generated images and layout metrics are ignored under
`generated-artifacts/mobile-navigation/`. The `before-home-*` images use an
isolated build of the original tracked frontend, including its Tailwind/PostCSS
configuration and the same fixture data/assets. The `after-*` images capture
the modified frontend. `comparison-home-390.png` places both versions side by
side. At 768 and 1600 px the initial homepage screenshots have zero changed
pixel channels. A separate screenshot also checks the real running guest page.

## Limits

These are Chromium browser checks, not physical iOS/Android device tests.
The installed Chromium does not expose safe-area inset emulation. Safe-area
padding and dialog height use CSS `env()` values, and keyboard hiding is checked
by editable focus; a real operating-system keyboard/notch was not simulated.
Creator/Admin roles are synthetic UI fixtures, not changes to real accounts.
No live deployment was performed.
