---
name: Single-use action responses
description: Retry and wording boundaries for non-idempotent writes, including uploads and email verification.
---

Do not automatically retry single-use token redemption through the shared API helper. A lost response can follow a committed success, and the retry then returns “already used,” hiding the original outcome.

Treat non-idempotent media uploads the same way: an uncertain save is not a confirmed rejection. Do not offer immediate retry for ambiguous outcomes without first establishing whether the file exists.

**Why:** The shared API transport and mutation defaults retry failed requests. A network/server error cannot prove whether the server committed the action; repeating an upload can duplicate a file.

**How to apply:** Opt out of both transport and mutation retries for these writes. Keep uncertain outcomes distinct from confirmed success. For one-use links, use a bounded POST without raw error logging and offer a session/status check or reopening the original email. For uploads, direct users to the media listing before selecting an unconfirmed file again. Never equate verification of a link’s account with verification of the currently signed-in account.

Apply the same boundary to event creation and its follow-up imports/reviews.
A committed event must not be reported as creation failure merely because a
later safety review or read failed. A confirmed event with unsuccessful source
setup must reuse that event on retry; a lost creation acknowledgement must not
automatically create another event.

After an uncertain mutable-settings write, a read-back confirms only the
current stored values, not which earlier request wrote them. Keep the input
draft and let the user compare it before a new explicit save; do not turn an
independent read into a retroactive “saved” acknowledgement.

**Why:** Another editor may have committed different values while the original
response was lost. Automatically replacing the draft or claiming that the
original request succeeded would misrepresent that outcome.

**How to apply:** Separate confirmed write acknowledgements from recovery reads,
block blind retries until an explicit check, and keep recovery wording about
current stored settings rather than the original commit.

**Why:** Follow-up failures can otherwise invite duplicates despite a successful
event transaction. Confirming creation is not confirmation of import start or
safety approval.

**How to apply:** Report creation, background-job acceptance and safety state
separately. Preserve inputs and actionable recovery information, and keep
unconfirmed creation distinct from a definite rejection.
