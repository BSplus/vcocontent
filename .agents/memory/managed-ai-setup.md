---
name: Managed AI setup
description: Dedicated provisioning for Replit-managed OpenAI versus ordinary connector discovery.
---

Replit-managed OpenAI has a dedicated provisioning flow, separate from ordinary connector discovery. When available through the current task instructions, call setupReplitAIIntegrations with providerSlug set to openai.

**Why:** Connector discovery returned no OpenAI entry, but the user-supplied dedicated setup command succeeded and provisioned the runtime configuration. An empty connector search must not be interpreted as proof that managed AI cannot be enabled.

**How to apply:** Use the documented or explicitly supplied managed-AI setup callback rather than guessing connector IDs or manually setting managed credentials. Restart the app afterward, then verify a real authenticated connection check in the running server and a non-mutating image-analysis request. Distinguish development verification from published-app verification.