---
name: Disposable media test isolation
description: Why process-based media checks need a private temporary-file scope as well as a disposable database
---
Media fixtures must isolate temporary storage from both the development server
and previous interrupted fixture processes, not just isolate database rows.

**Why:** Interrupted video requests leave recent leased directories behind.
A later suite can mistake them for its own leaked output; a shared cleaner
could also act on another server's active media extraction.

**How to apply:** Run media integration suites through the disposable runner,
which gives subprocesses their own temporary-file scope. Wait for an actual
failed attempt before asserting retry state: the initial queued state is not
proof that a request ran or finished.
