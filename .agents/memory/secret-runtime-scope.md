---
name: Secret metadata versus published runtime
description: Environment-labelled secret existence is not proof of credential injection in the running deployment.
---

Treat secret-existence metadata as inventory, not evidence that a particular
credential name/value is injected into the deployed process.

**Why:** A Production-scoped metadata view reported Development R2 secret names
although published process injection was not inspected and the official
documentation describes separate environments. Inferring automatic sharing or
successful isolation from that view alone would overstate the evidence.

**How to apply:** Check the intended environment configuration and independently
verified runtime target before activation. Keep fail-closed opposite-environment
credential guards; flag uncertain runtime injection for verification, without
reading secret values or changing either environment to resolve the ambiguity.

Publishing's manually entered deployment configuration may not appear in the
workspace inventory. When the two disagree, use runtime evidence rather than
declaring that the operator did not configure the values.

**Why:** After a publish, inventory still omitted the operator's Production R2
configuration, while the startup stack reached the opposite-environment
credential-presence guard after passing the runtime database-target check.

**How to apply:** Map a startup stack to the corresponding built guard. Its
failure can establish unwanted variable presence without reading values.
The opposite-environment guard is symmetric: its stack alone does not establish
which credential names triggered it without the resolved environment. A
Publishing screenshot describes selected configuration, not necessarily the
last deployed process. Verify the environment and publish timing before asking
the operator to repeat a configuration change. Keep the fail-closed guard and
keep Development credentials available only to Development.

**Observed platform boundary:** The operator showed Development R2 secrets as
missing from the Production Publishing environment and confirmed republishing
after excluding them. Credential-safe startup diagnostics nevertheless reported
both Development variable names present in a process resolved as Production.
This establishes presence, not non-empty values or the source of injection.

**Why:** Repeating the same UI exclusion instruction did not resolve the runtime
mismatch and incorrectly implied an operator configuration mistake.

**How to apply:** Do not claim UI exclusions guarantee runtime absence. Preserve
the isolation checks; propose a separately approved Production launch isolation
change if needed, without inspecting credentials or changing Development access.
