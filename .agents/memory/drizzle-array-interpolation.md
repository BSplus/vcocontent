---
name: Drizzle raw SQL array interpolation
description: JavaScript arrays in raw SQL templates can become SQL lists rather than typed PostgreSQL array parameters.
---

Do not assume an interpolated JavaScript array is a single PostgreSQL array parameter in a Drizzle SQL template.

**Why:** Array interpolation can produce a SQL record/list that fails when cast to `text[]`. A background consumer can then leave jobs queued, making a query error look like scheduling starvation.

**How to apply:** Use a correctly typed bound array or an explicitly constructed SQL array. Verify the generated SQL and inspect worker errors when a scoped consumer never claims eligible jobs.
