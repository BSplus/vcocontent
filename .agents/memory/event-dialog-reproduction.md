---
name: Repeated event-dialog whitespace reports
description: Distinguish a reported screenshot from a reproducible current or shipped layout failure.
---

Bei erneuten Leerraum-Meldungen am Eventdialog zuerst die tatsächliche Endgeometrie
mit realistischem Importfehler und verzögerten Datenantworten in Vorschau, frischem
Build und ausgelieferten Dateien vergleichen. Nicht allein anhand eines
Screenshots den früheren Layoutfix wiederholen.

**Why:** Ein gemeldeter großer Leerraum trat mit denselben Fehler-Fixtures in
keinem dieser Stände auf; auch die ausgelieferte Version enthielt bereits den
früheren Fix. Eine andere Bundle-Kennung beweist keinen veralteten Layoutstand.

**How to apply:** Den Originalbrowser/-zustand ausdrücklich als ungeprüft
kennzeichnen, wenn nur isolierte Fixtures auf veröffentlichten Dateien getestet
wurden. Ohne Reproduktion weder einen neuen CSS-Fix noch Browsercache als
bewiesene Ursache darstellen.
