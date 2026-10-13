---
name: Browser role assertions
description: How to avoid premature role-based navigation assertions in browser smoke tests.
---

For role-based browser tests, waiting for a page title or path is not sufficient before checking authenticated navigation; wait for the role-dependent element or a settled auth state.

**Why:** Public page content can render before the asynchronous user query finishes, so an approved user's Creator link may be temporarily absent even though access is correct.

**How to apply:** When testing navigation after setting a session cookie, poll for the expected role-specific UI separately from the page's static content.

Browser polling expressions should return booleans, not DOM elements; serialize dialog transitions before clicking a new opener, and scope error assertions to the feature being tested.

**Why:** Serializing React-connected DOM nodes through the browser protocol can fail with a deep object-reference error. Closing dialogs can still intercept the next pointer action, and unrelated editor warnings can be the first alert in the page.

**How to apply:** Use explicit boolean conditions, wait for the previous dialog and its pointer lock to disappear, and query the relevant section rather than the first global alert.

Media previews can change dialog layout while a coordinate-based browser action
is in flight, especially when synthetic videos fail to decode.

**Why:** A late codec warning can move the submit button after its coordinates
were measured, making a validation test appear to fail without submitting.

**How to apply:** For form-validation checks, use native form submission to
isolate validation; test pointer/touch target behavior separately with stable
preview fixtures. Keep unrelated preview errors separate from tag-field errors.

Wait for destination-specific content after navigation, not just a shared header,
and filter responsive controls by visibility before selecting the first match.

**Why:** A shared header can satisfy a readiness check on the page being left;
desktop and mobile controls can coexist in the DOM even when one is hidden.
Both produce misleading missing-control failures in otherwise working flows.

**How to apply:** Require the target page's heading or content together with
the control, and select a visible control rather than testing visibility only
after choosing the first DOM match.

Mock all background endpoints with their real response shapes, including
features not directly under test. A valid element can disappear between a wait
and an interaction if an unrelated query subsequently crashes its parent.

**Why:** Returning a generic object for an array endpoint caused a rendered
dashboard to unmount during a tab test, resembling a timing or navigation bug.

**How to apply:** Use explicit response contracts for background list requests,
and inspect runtime exceptions before adding waits or retries.