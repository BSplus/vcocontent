---
name: Startup paint verification
description: Startup paint checks for delayed stylesheets and fonts, including bounded, stable fallback behaviour.
---

Verify the actual paint while production stylesheets are held, not just computed DOM visibility.

**Why:** The production build's render-blocking stylesheet prevented even an already-inline-styled startup shell from painting. DOM visibility checks passed while a real screenshot could not complete until CSS arrived. Development CSS module injection did not expose this difference.

**How to apply:** Keep preview and built-bundle delayed-resource checks separate. Assert painted dark-background pixels with a bounded screenshot wait; retain ordinary stylesheet loading for no-JavaScript visitors whenever changing production CSS loading.

Stylesheet readiness alone does not mean typography is ready. Wait for the brand fonts before first content paint, but bound that wait and keep the chosen fallback stable for the rest of a slow/failed-font visit.

**Why:** Swap-mode fonts can resize already-styled headings and navigation after the startup shell is removed. An unlimited wait would instead make a missing font block the application.

**How to apply:** Test held fonts, failed fonts and fonts arriving after the fallback deadline in both preview and the built app. Keep body and utility typography on the same font variables; do not clear a timeout fallback during ordinary navigation.
