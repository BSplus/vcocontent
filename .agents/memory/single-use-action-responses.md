---
name: Single-use action responses
description: Retry and wording boundaries for non-idempotent writes, including uploads and email verification.
---

Do not automatically retry single-use token redemption through the shared API helper. A lost response can follow a committed success, and the retry then returns “already used,” hiding the original outcome.

Treat non-idempotent media uploads the same way: an uncertain save is not a confirmed rejection. Do not offer immediate retry for ambiguous outcomes without first establishing whether the file exists.

**Why:** The shared API transport and mutation defaults retry failed requests. A network/server error cannot prove whether the server committed the action; repeating an upload can duplicate a file.

**How to apply:** Opt out of both transport and mutation retries for these writes. Keep uncertain outcomes distinct from confirmed success. For one-use links, use a bounded POST without raw error logging and offer a session/status check or reopening the original email. For uploads, direct users to the media listing before selecting an unconfirmed file again. Never equate verification of a link’s account with verification of the currently signed-in account.
