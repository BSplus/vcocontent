---
name: Polling cancellation boundaries
description: Periodic refresh must not starve valid requests that take longer than the polling interval.
---
Skip automatic polling ticks while the same resource has an in-flight request. Reserve cancellation for explicit refreshes, navigation or resource changes.

**Why:** Cancelling on every polling tick can prevent any response from completing when latency exceeds the interval. Fast synthetic fixtures do not reveal this failure.

**How to apply:** For any polling UI, include a response delayed beyond one interval in browser checks. Keep request ownership explicit so an obsolete request's cleanup cannot clear a newer request.
