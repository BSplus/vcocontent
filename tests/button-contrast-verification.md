# Button hover contrast verification

## Reproduce

With the preview workflow running:

```sh
npm run check
npm run test:button-contrast
node --import tsx --test --test-concurrency=1 tests/ui-click-targets.test.mjs tests/navigation-layout-ui.test.mjs
```

`test:button-contrast` builds the frontend, then tests both the preview and the
actual built bundle on an ephemeral local server. No production publication,
database access or persistent writes are involved in the new contrast tests.
All `/api/*` calls are intercepted with isolated, role-specific fixtures; any
non-GET request fails the test.

To retain hover screenshots for visual inspection, prefix the contrast command
with `BUTTON_CONTRAST_SCREENSHOTS=1`. Images are written to the already ignored
`generated-artifacts/button-contrast/` directory.

## Browser-confirmed findings and fixes

Measured in Chromium at CSS viewport widths of 1920 and 390 pixels. Values below
are rounded; the assertion uses the unrounded value and requires at least 4.5:1.

| Control | Before | After |
| --- | --- | --- |
| Home: Browse recent events | Hover 1.00:1 (dark text on dark overlay) | Normal/focus ≥14.30:1; hover ≥14.88:1 |
| Home: All recent events, including arrow | Hover 2.54:1 (blue on mint) | Hover 5.12:1; normal/focus 9.86:1 |
| Home: All creator events, including arrow | Hover 1.00:1 (mint on mint) | Hover 11.63:1; normal/focus 9.86:1 |
| Event card: Manage media, including icon | Hover 1.39:1 | Hover 10.48:1; normal/focus 14.60:1 |
| Used desktop navigation: Become a creator | Hover 1.25:1 | Hover 11.65:1; normal/focus 14.60:1 |
| Creator profile: Archive, including arrow, over white cover | Normal/focus 3.03:1; hover 2.65:1 | Normal/focus 11.55:1; hover 15.91:1 |
| Media-grid preview: previous/next arrows over white photo | Hover 1.15:1 | Hover 17.22:1; normal/focus 10.36:1 |

Corrections are local background/foreground pairs. The shared outline and ghost
defaults, primary/accent tokens and their valid dark-text-on-bright-accent pairing
remain unchanged. The stronger profile overlay also keeps its normal state
readable over bright user-provided cover images.

The search filled button, gallery filled link, ordinary outline/ghost controls,
desktop navigation link and mobile menu close/account controls are checked as
unchanged controls. They remain above 4.5:1. The alternative root-level
`client/src/main-navigation.tsx` has no consumers; it is not counted as visible
UI and was not changed.

## What the assertions measure

- Real CDP mouse movement activates hover, followed by a 350 ms transition wait.
- Keyboard Tab and Shift+Tab establish `:focus-visible`; the existing focus
  indicator and text/icon contrast are checked.
- Computed text and SVG stroke colors are compared with painted background
  pixels sampled in four empty interior corners of each button. This includes
  transparency, images, gradients, overlays and actual underlying surfaces.
- A white cover/photo fixture deliberately exercises the bright-image case.
- Control visibility, center-point hit testing, clipping and horizontal overflow
  are checked. Enter still opens recent events and advances the media preview;
  mobile navigation remains operable by touch, and dialogs close with Escape.
- Hover captures from the built bundle were visually inspected, including the
  hero, a bright-cover profile and the narrow-view blue-text ghost link.

Type checking, production build, both contrast targets, and the existing click
target/navigation tests passed. Existing build warnings about Browserslist data
age and bundle size are unrelated to this change.

## Boundaries

This is a targeted regression check, not a full accessibility audit. It uses
desktop Chromium with narrow-screen/touch emulation, not physical phone browsers.
It checks settled states rather than every animation frame. Background samples
are representative empty button interiors, not an exhaustive pixel-by-pixel
contrast audit of arbitrary future photographs. No live authenticated account
or production data was used. The public preview screenshot additionally showed
the unchanged VCO layout with the corrected hero control.
