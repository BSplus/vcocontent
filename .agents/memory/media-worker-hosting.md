---
name: Media worker hosting approval
description: Operator constraints on continuous background hosting and infrastructure changes
---

The operator requires cost estimates and confirmation of recovery, concurrency
limits and compatibility before approving hosting changes. After reviewing the
focused development results, they approved the recommended single 0.5 vCPU /
2 GiB Reserved VM with sequential analysis. Future hosting changes still require
explicit approval; do not treat that choice as approval for larger capacity or
additional paid services.

Keep the existing application architecture wherever possible. Do not introduce unnecessary infrastructure or create a separate paid worker deployment unless technically required and explicitly approved.

For occasional batch uploads, the operator prioritizes reliability, simplicity
and cost efficiency rather than maximum processing speed. They authorize focused
development-only recovery/resource/upload checks and sequential-processing
evaluation before approving hosting changes, not extensive benchmarking.

**Why:** The user explicitly stated these constraints while assessing continuous background analysis hosting.

**How to apply:** Prefer the existing combined web application and background worker on one VM. Explain incremental hosting costs and operational limitations before requesting approval; a preference for Reserved VM is not permission to change deployment configuration.
