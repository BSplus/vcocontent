---
name: Admin diagnostic cooldown
description: Why the OpenAI connection probe uses a process-local limit and when to revisit it
---

The admin connection diagnostic uses a process-local cooldown rather than a shared database-backed limiter.

**Why:** This is a low-volume manual diagnostic, so avoiding a database write for every probe is proportionate for a single application process. It does not guarantee a global cap across replicas or restarts.

**How to apply:** If the app runs multiple independent server processes or the diagnostic needs a strict global spend limit, replace the local cooldown with shared atomic coordination; keep the per-admin retry response and concurrency protection.