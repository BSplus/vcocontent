---
name: Drizzle raw SQL array interpolation
description: JavaScript arrays in raw SQL templates can become SQL lists rather than typed PostgreSQL array parameters.
---

Do not assume an interpolated JavaScript array is a single PostgreSQL array parameter in a Drizzle SQL template.

**Why:** Array interpolation can produce a SQL record/list that fails when cast to `text[]`. A background consumer can then leave jobs queued, making a query error look like scheduling starvation.

**How to apply:** Use a correctly typed bound array or an explicitly constructed SQL array. Verify the generated SQL and inspect worker errors when a scoped consumer never claims eligible jobs.

Correlated subqueries embedded in a single-table Drizzle selection need an explicitly qualified outer reference that survives SQL generation.

**Why:** Drizzle can remove column qualifiers when building a single-table selection, including inside an embedded SQL subquery. An outer ID then binds to an inner ID, returning another gallery's candidate despite apparently correct source SQL.

**How to apply:** Inspect generated SQL and test multiple distinct owners/galleries, not just one fixture. Use a fixed, explicitly qualified outer identifier in embedded correlated SQL; never interpolate user-controlled identifiers.
