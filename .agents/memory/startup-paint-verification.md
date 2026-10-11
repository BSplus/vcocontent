---
name: Startup paint verification
description: Why delayed-resource startup tests must inspect painted pixels in production as well as DOM visibility.
---

Verify the actual paint while production stylesheets are held, not just computed DOM visibility.

**Why:** The production build's render-blocking stylesheet prevented even an already-inline-styled startup shell from painting. DOM visibility checks passed while a real screenshot could not complete until CSS arrived. Development CSS module injection did not expose this difference.

**How to apply:** Keep preview and built-bundle delayed-resource checks separate. Assert painted dark-background pixels with a bounded screenshot wait; retain ordinary stylesheet loading for no-JavaScript visitors whenever changing production CSS loading.
