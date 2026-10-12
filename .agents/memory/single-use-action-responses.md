---
name: Single-use action responses
description: Retry and wording boundaries for email verification and other one-use account actions.
---

Do not automatically retry single-use token redemption through the shared API helper. A lost response can follow a committed success, and the retry then returns “already used,” hiding the original outcome.

**Why:** The shared API transport and mutation defaults retry failed requests. For email confirmation, a network/server error cannot prove whether the server committed the action.

**How to apply:** Use a bounded, single POST without raw error logging for one-use action links. Keep uncertain outcomes distinct from confirmed success; offer a session/status check or reopening the original email. Never equate verification of a link’s account with verification of the currently signed-in account.
