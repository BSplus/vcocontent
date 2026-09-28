---
name: Radix tabs in browser checks
description: Browser regression checks need to activate Radix tabs with the same event the widget handles.
---

Radix tabs may remain on the original panel when a headless browser test invokes element.click() from script. Simulate a primary-button mousedown or use keyboard activation instead.

**Why:** Several browser-check attempts falsely reported a missing media panel even though the tab control and its content worked; the Radix trigger listens for mousedown rather than click.

**How to apply:** When tests programmatically operate accessible tab widgets, assert the selected tab state after sending the event, before diagnosing the panel as absent.