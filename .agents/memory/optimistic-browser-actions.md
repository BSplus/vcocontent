---
name: Optimistische Browseraktionen prüfen
description: Sichtbarer neuer Zustand ist nicht gleich abgeschlossene Mutation
---

Bei Browserchecks optimistischer Aktionen vor der nächsten Aktion auf ein wieder
aktiviertes Bedienelement warten, nicht nur auf den geänderten Text oder `aria-pressed`.

**Why:** Die Anzeige kann schon vor der Serverantwort wechseln. Ein sofortiger zweiter
synthetischer Klick auf den noch deaktivierten Button wird verworfen und erzeugt
einen irreführenden Testfehler.

**How to apply:** Optimistische Darstellung und abgeschlossene Interaktion getrennt
prüfen; bei Tabwechseln stabile Elemente statt CSS-großgeschriebenem `innerText` nutzen.
