---
name: Local Neon test transport
description: Running the Neon driver against disposable trust-authenticated PostgreSQL without changing the connected database.
---

For disposable local PostgreSQL with trust authentication, turn off Neon's
password-connect pipelining as well as TLS in the loopback WebSocket transport.
Specify a synthetic database username explicitly instead of inheriting PGUSER.

**Why:** Neon can proactively send a password before a trust-authenticated
server asks for one, producing an invalid frontend-message error that looks
like a transport problem. The workspace's PostgreSQL CLI environment may also
select a different role from the one created by initdb.

**How to apply:** Keep this configuration confined to isolated test preload/
runner code. Never weaken authentication or transport settings in app runtime.
When the connected schema lacks unrelated current columns, use a disposable
local schema for regression checks rather than changing a potentially shared
database just to run tests.
