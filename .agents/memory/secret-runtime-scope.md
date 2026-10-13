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
the isolation checks. The operator approved preparation of Production-only
launch isolation: remove just the Development R2 variable names from the child
application environment, not from the stored Development secrets.

**Why:** This preserves Development access and the strict application guard
without credential inspection, secret renaming or repeatedly ineffective UI
exclusions. It is an explicit isolation workaround, not evidence that the
original injection source was identified.

The operator confirmed that the isolated startup worked after publishing.
Retain this Production-only isolation unless runtime evidence establishes that
the original unwanted injection has been resolved.

**How to apply:** Retain Production/authentication/integration configuration and
all target, bucket and upload safeguards. Applying the prepared command still
requires the operator's publish; preparation does not authorize automatic
publishing or ordinary uploads.
