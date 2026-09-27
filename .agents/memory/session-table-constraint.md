---
name: Session table constraint
description: A PostgreSQL session-table compatibility caveat for this project.
---

When using connect-pg-simple against the existing database, prefer reusing its
compatible session table instead of creating another table with a custom name.

**Why:** The package's bundled table definition uses a fixed primary-key
constraint name. Creating a second table in the same schema collided with the
first table's constraint and caused every session-backed request to fail.

**How to apply:** Before changing the session table or storage library, inspect
the current database schema and verify registration and login against it.