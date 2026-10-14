---
name: Managed AI output contracts
description: Why successful recognition text is not proof of complete downstream evidence
---

Keep the producer's output example/schema consistent with every downstream
evidence requirement, including spatial context for non-numeric recognition.
Do not rely on a later optional prose instruction to add data missing from the
declared response shape.

**Why:** An authorized real-provider check correctly named a car manufacturer
but omitted localization. The result was recognizable yet unusable by the
independent source-crop audit. Aligning the declared format and instructions
restored useful output without relaxing evidence requirements.

**How to apply:** When adding vision-derived captions/tags, review both the
model's declared format and narrative instructions. Preserve an explicit
unknown/null option rather than forcing fabricated geometry. Distinguish
provider success, evidence completeness and accepted caption facts; never
promote a plausible first-pass name merely because its verification data is
missing.
