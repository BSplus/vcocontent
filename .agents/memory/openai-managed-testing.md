---
name: Managed OpenAI testing
description: SDK transport behavior when mocking Replit-managed OpenAI requests
---

The OpenAI JavaScript SDK version used here captures its default fetch transport when the SDK module loads. Replacing global fetch after importing the application does not intercept client requests unless the client explicitly receives the current fetch function.

**Why:** A simulated managed image request repeatedly failed with a connection error even though global fetch was stubbed; passing fetch into the client made the request observable without using real credentials.

**How to apply:** When testing managed provider requests, ensure the HTTP transport is injected at client construction, and keep provider responses and credentials out of test failure logs.