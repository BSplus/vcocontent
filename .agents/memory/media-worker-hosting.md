---
name: Media worker hosting approval
description: Operator constraints on continuous background hosting and infrastructure changes
---

The operator requires cost estimates and confirmation of recovery, concurrency
limits and compatibility before approving hosting changes. After reviewing the
focused development results, they approved the recommended single 0.5 vCPU /
2 GiB Reserved VM with sequential analysis. They explicitly authorized preparing
that configuration, but publishing and a live restart still need separate approval.
Future hosting changes still require
explicit approval; do not treat that choice as approval for larger capacity or
additional paid services.

Keep the existing application architecture wherever possible. Do not introduce unnecessary infrastructure or create a separate paid worker deployment unless technically required and explicitly approved.

For occasional batch uploads, the operator prioritizes reliability, simplicity
and cost efficiency rather than maximum processing speed. They authorize focused
development-only recovery/resource/upload checks and sequential-processing
evaluation before approving hosting changes, not extensive benchmarking.

**Why:** The user explicitly stated these constraints while assessing continuous background analysis hosting.

**How to apply:** Prefer the existing combined web application and background worker on one VM. Explain incremental hosting costs and operational limitations before requesting approval; a preference for Reserved VM is not permission to change deployment configuration.

Do not change production access settings or disable authentication for validation.

**Why:** The user explicitly required preserving production access settings and authentication when discussing live-test access.

**How to apply:** Keep deployment privacy and application login intact. Explain the purpose and scope of any requested access token before requesting it through the secure secrets flow.

Do not infer production video-analysis readiness from a successful build, image
analysis or development half-core simulation.

**Why:** The authorized live validation demonstrated that an image path can
succeed while video analysis still fails on the deployed environment.

**How to apply:** Require a successful actual-VM video path before declaring
hosting compatibility. When a one-time validation fails, report the evidence
and request separate approval for additional production diagnostics or retests;
do not infer provider billing or the failure cause from a generic job status.
