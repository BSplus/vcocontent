---
name: Production recovery boundary
description: Operator-confirmed PITR and timestamp handling for Production data cleanup.
---

On 13 October 2026, the operator confirmed Production PITR enabled with a
7-day recovery window. Its restore dialog accepts an exact timestamp in
Europe/Berlin; it does not list individual PITR snapshots.

**Why:** A snapshot list was incorrectly treated as needed to verify a recovery
point. PITR is timestamp-based. Configured availability does not prove a
successful restore rehearsal.

**How to apply:** Reconfirm the current setting and timestamp coverage before
destructive work. Record an explicit-offset pre-operation timestamp and ensure
restore access. Do not initiate a live restore simply to test it. Recovery
rewinds the database, not selected records or app code; control intervening
writes. Agent's supported Production database access is read-only, so the
guarded cleanup transaction is operator-run, not an agent bypass.
