---
name: Photo number evidence
description: Pixel-audit pitfalls and the acceptance boundary for automatic race-entry enrichment.
---

Do not adopt an automatic number-evidence gate solely because it rejects known
false numbers or passes mocked provider contracts. Compare reviewed true numbers,
including printed leading zeros, on actual pixels and disclose omissions.

**Why:** Independent whole-image and cropped rereads still accepted a masked
prefix as a complete number on repetition. Requiring two panels then rejected
even a clear dual-panel positive control. Passing mocked tests hid these failures.

**How to apply:** Keep targets and pixels frozen, repeat negative cases before
adoption, compare unchanged initial observations when isolating a number gate,
and distinguish true-pixel outcomes from transport/parser tests. Provider box
coordinates are approximate, not measurements or proof of a full panel.
Keep candidates that introduce unsafe identities out of photo analysis, caption detection and cache reuse;
do not silently replace automatic matching with human confirmation without
an explicit product decision.

A real number somewhere in a multi-car image is not evidence for the car
described by the first reader. Bind number evidence to that specific car's
source-pixel region before using entry lists; matching digit strings alone
must not transfer a car description, team or registered lineup.

**Why:** A whole-image/detail-view number set could confirm a first car using
the second car's correctly read number, despite otherwise successful tests.

**How to apply:** Include deliberate cross-car borrowing in regression inputs
and separate geometric/car ownership from digit agreement. Stronger readers
and syntactically valid model boxes still require unchanged real-pixel
positive controls; safe unknown results do not justify hiding recall failures.

The operator's acceptance boundary is improvement over the previous solution,
not perfect recognition: “Nicht kompliziert machen. Uns werden auch Nummern
durchrutschen. Wenn diese lösung nun zumindest besser funktioniert als zu or,
gebe ich sie frei.”

**Why:** the user approved a measured improvement despite occasional omissions
of a genuinely visible number; further model research is not a prerequisite.

**How to apply:** accept demonstrably improved automatic safeguards with explicit
limits, without loosening test targets or claiming flawless recognition.
This does not authorize publishing, live corrections or global reanalysis.

Local OCR preprocessing is only a proposal, not race-number proof: preserve
complete contiguous glyph groups, do not use a digit whitelist, and show
unmodified source crops to the semantic checker rather than segmented masks.

**Why:** whole-photo OCR and light connected regions confused borders/background
with digits or missed real numbers; clean glyph OCR recovered printed leading
zeros but did not reliably cover outlined/slanted numbers.

**How to apply:** retain actual-pixel negative and positive controls, keep CPU
threads/process output/runtime bounded, and do not certify a cropped prefix or
hide failures on reviewed positives. Explicit axis normalization
helps model boxes but does not make their coordinates measured evidence.

For securing new automatic team/registered-lineup assignments, the user chose:
“Nur eine automatische Lösung zulassen.” Do not require an additional human
number-confirmation step.

**Why:** the user explicitly chose automatic-only after manual confirmation was offered.

**How to apply:** preserve existing protected manual editing, but do not make
a new human approval workflow the prerequisite for this automatic safeguard.

Change the evidence-policy marker when acceptance semantics change; do not
globally bump the analysis fingerprint merely to upgrade historical proof.

**Why:** old observations lack independent pixel evidence, while automatically
reenqueuing the stock would exceed the agreed no-global-reanalysis boundary.

**How to apply:** treat mismatched historical proof as unknown during selected
rematching; acquire fresh proof through explicit selected-photo reanalysis.

Distinguish a genuine identity contradiction from a literal registered team core
or manufacturer badge. Do not respond to false vetoes by dropping all weak-reader
constraints or accepting arbitrary sponsor aliases.

**Why:** Reviewed complete numbers were correctly recognized but omitted from
captions because MAHLE/EMM were compared to organisationally suffixed team names,
and AMG branding was treated as a competing team. Other reviewed cases had
genuinely incorrect weak model/team hints, so one global exemption would hide
different failure causes.

**How to apply:** validate bounded exact-name changes against checked source
pixels and both positive and conflict controls. Report local rematching gains
separately from recognition accuracy, and never silently requeue completed live
photos solely because a matching rule changed.

A shortened vehicle inscription is not proof of a competing registered team,
nor proof of a commercial sponsor. Keep its purpose unknown unless independently
assessed on the same car; old number proof alone cannot certify new lettering.

**Why:** A real unique entry was blocked by its shortened on-car name. Calling
that name a sponsor would have invented a different explanation rather than
resolving the actual ambiguity.

**How to apply:** Compare literal independently checked lettering with applicable
official names conservatively, retain genuine and uncertain conflicts, and
separate mocked successful rematching from a real-pixel evaluation.
