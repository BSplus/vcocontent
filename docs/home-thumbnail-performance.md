# Startseiten-Thumbnails: lokaler Vorher-/Nachher-Vergleich

## Umsetzung

- Legacy- und offizielle Inline-Bilder teilen einen prozesslokalen LRU-Ausgabe-Cache: höchstens 64 Einträge, 4 MiB insgesamt, 100 KiB pro gespeichertem Ergebnis und fünf Minuten Gültigkeit. Gleichzeitige Berechnungen desselben Inhalts werden zusammengeführt. Fehler bleiben nicht im Cache. Die bestehende CPU-Warteschlange, Pixelgrenzen, Bildkante und jeweiligen Qualitätsstufen bleiben erhalten.
- Moderne vorberechnete Thumbnails werden unverändert ausgeliefert, nicht erneut konvertiert. Historische größere Objekt-Thumbnails behalten eine begrenzte Streaming-Auslieferung ohne Browser-Wiederverwendung.
- `private, no-cache, max-age=0, must-revalidate`, Inhaltsvalidatoren und `Vary: Cookie` erlauben Wiederverwendung erst nach einer neuen Rechteprüfung. Änderungen an Legacy-/Inline-Quellen ändern den Validator auch bei identischem konvertiertem Ergebnis. Bei Objekten werden die aktuellen Bytes über den bestehenden integritätsgeprüften Storage-Pfad gelesen. Keine Rechte werden aus dem Ausgabe-Cache übernommen.
- Die öffentliche Eventliste liefert den zulässigen Galerie-Fallback in derselben Datenbankanfrage mit. Die vorhandene Auswahl bleibt: eigenes Thumbnail, Cover, erstes zulässiges Foto der bisherigen neuesten öffentlichen 48 Medien, Standardbild. Die korrelierte Abfrage nutzt den vorhandenen Eventseiten-Index; sie sortiert nicht das gesamte Medienarchiv. Es werden keine neuen Indizes oder Schemaänderungen benötigt.
- Ausgewählte verwaltete Galeriebilder werden über die autorisierte Eventbild-Route direkt statt mit einem zusätzlichen Bild-Redirect geliefert. Alte URLs ohne `direct=1` funktionieren weiter.
- Thumbnail-Autorisierungen lesen keine historischen Original-Base64-Felder; Event-Metadatenabfragen lassen nicht benötigte Bildfelder weg. Downloads behalten ihre Regeln, Qualität und Statistik.
- Creator-Medienlisten warten nicht mehr auf Top Shots. Sichtbare Bilder erhalten hohe Abrufpriorität. Nur das erste Poster jeder Medienreihe darf den normalen Lazy-Loading-Vorlauf des Browsers nutzen; alle weiteren Poster sowie Eventkarten warten auf tatsächliche Sichtbarkeit. Horizontales Swipen lädt die neu sichtbaren Bilder.

## Messbedingungen und Grenzen

Gemessen am 13. Oktober 2026 mit einem isolierten Express-Server, den echten Thumbnail-Routen und separat gebauten Vorher-/Nachher-Frontends. Beide Builds verwenden dieselben Assets, CSS-Konfiguration und installierten Abhängigkeiten. Die unveränderte Vorher-Version wurde separat im ignorierten Verzeichnis `generated-artifacts/home-thumbnails/baseline-source` gebaut.

Die synthetischen Daten enthalten vier offizielle und vier Creator-Events sowie Inline-, Legacy-, vorberechnete Objektbilder und Karten ohne eigenes Bild. Alle Eventdaten einer Messung haben denselben jüngsten Zeitstempel, damit die Reihenfolge stabil bleibt. Ein deterministisch texturiertes JPEG hat **1.902.805 Bytes**, der vorberechnete WebP **37.990 Bytes**, das offizielle Inline-Ausgabeformat **44.988 Bytes**. Dieselbe Quelle wird bewusst mehrfach verwendet, um das gemeldete wiederholte Konvertieren desselben Bildes zu isolieren.

Datenbankantworten werden durch isolierte Speicher-Fixtures mit **30 ms pro Zugriff** ersetzt, Objekt-Reads durch einen privaten synthetischen Stream mit **40 ms**. Das sind **keine gemessenen Neon-/R2-/App-Storage-Latenzen**. Datenbankabfragen und deren tatsächliche Rechtefilter wurden zusätzlich gegen eine kurzlebige lokale PostgreSQL-Datenbank geprüft, nicht gegen Production. Originalfelder werden dort tatsächlich aus den Thumbnail-Projektionen ausgeschlossen.

HTTP-Messungen trennen ersten Server-Abruf, Wiederholung mit `If-None-Match` und sechs gleichzeitige Wiederholungen ohne Browser-Validator. Browsermessungen trennen leeren Browsercache von einem anschließenden Wiederholungsaufruf. **Der Server-Ausgabe-Cache ist bei den Browsermessungen bereits durch die HTTP-Prüfungen warm.** Diese Browserwerte belegen keinen vollständigen Server-Kaltstart.

Für jede Reihe erfolgt eine eigene Navigation. Die Reihe wird nach Bereitstellung ihrer Liste in den sichtbaren Bereich gebracht. Bildzeiten werden erst erfasst, wenn das Bild dekodiert, im Viewport und nach Freigabe der tatsächlichen Startseiten-Sichtbarkeit über zwei Animationsframes darstellbar ist. DOM-Bereitschaft in einem alten Dokument zählt nicht. Anfragen/Bytes werden über ein gleiches **2-Sekunden-Fenster** erfasst. Anfragen enthalten Redirect-Folgeschritte; Bytes sind die `transferSize`-Werte der abgeschlossenen API-Ressourcen einschließlich Browser-Header-Schätzung. Nicht enthalten sind JS, CSS, Fonts, statische Assets, TLS-Kosten und eine exakte Headerbilanz für Redirects.

Messung und Builds/Regressionstests liefen nacheinander, nicht gleichzeitig. Einzelne Browserwerte schwanken durch Startseiten-Fonts, Layout, Browser-Scheduling und begrenzten Look-ahead. Es handelt sich um begrenzte lokale Vergleichsstichproben, **nicht um garantierte Live-Latenzen oder einen statistischen Beweis für jede einzelne Karte**. Die dominante Ursache im Livebetrieb wurde nicht gemessen.

## HTTP: Antwortzeit und übertragener Bildkörper

Zeit in ms; bei Parallelabrufen Mittelwert der sechs Antworten. Bytes beziehen sich nur auf den Bildkörper.

| Pfad | Abruf | Zeit vorher → nachher | Bytes vorher → nachher | Sharp-Konvertierungen vorher → nachher |
|---|---|---:|---:|---:|
| Offizielles Inline-Bild | erster Abruf | 143 → 142 | 44.988 → 44.988 | 1 → 1 |
| Offizielles Inline-Bild | Wiederholung | 69 → 64 | 44.988 → 0 | 0 → 0 |
| Offizielles Inline-Bild | 6 gleichzeitig, warm | 187 → 194 | 269.928 → 269.928 | 0 → 0 |
| Legacy-Thumbnail | erster Abruf | 128 → 134 | 37.990 → 37.990 | 1 → 1 |
| Legacy-Thumbnail | Wiederholung | 119 → 68 | 37.990 → 0 | 1 → 0 |
| Legacy-Thumbnail | 6 gleichzeitig, warm | 147 → 101 | 227.940 → 227.940 | 6 → 0 |
| Modernes Objekt-Thumbnail | erster Abruf | 107 → 106 | 37.990 → 37.990 | 0 → 0 |
| Modernes Objekt-Thumbnail | Wiederholung | 103 → 102 | 37.990 → 0 | 0 → 0 |
| Modernes Objekt-Thumbnail | 6 gleichzeitig | 107 → 107 | 227.940 → 227.940 | 0 → 0 |

Die erste Konvertierung bleibt notwendig. Bei sechs warmen Legacy-Abrufen sank die aggregierte gemessene Dauer der Sharp-Aufrufe von **437 ms auf 0 ms**. Das ist die Summe teilweise überlappender Aufrufzeiten einschließlich interner Wartezeit, keine Prozess-CPU-Zeit. Gleichzeitige **kalte** Berechnungen werden durch separate Tests nachgewiesen: sechs Anforderungen führen zu genau einer echten Konvertierung; nach einem Fehler kann erneut berechnet werden.

Die synthetische Wartezeit für einen normalen Legacy-/Objekt-Abruf bleibt ungefähr 60 ms für zwei aktuelle Metadaten-/Rechteabfragen; Objekt-Reads benötigen weiterhin ungefähr 40 ms. Die Optimierung beseitigt diese notwendigen Prüfungen nicht. Warmes Inline-Decoding war bereits vorher gecacht und zeigt entsprechend keine Konvertierungs-Einsparung. Listenwartezeiten, Einzelanfragen, Zugriffszeiten, Konvertierung und Storage-Arbeit sind getrennt in den JSON-Rohdaten erfasst.

## Browser: Anfragen und Bytes

„Kalt“ bedeutet leerer Browsercache, „warm“ die unmittelbar folgende Navigation für dieselbe Reihe. Umfang: API-Anfragen während der ersten zwei Sekunden.

| Viewport / Reihe | Cache | Anfragen vorher → nachher | Bytes vorher → nachher |
|---|---|---:|---:|
| Desktop / Eventkarten | kalt | 33 → 22 | 515.571 → 361.234 |
| Desktop / Eventkarten | warm | 33 → 22 | 515.181 → 11.936 |
| Desktop / Top Shots | kalt | 27 → 19 | 355.413 → 239.366 |
| Desktop / Top Shots | warm | 33 → 23 | 515.181 → 171.194 |
| Desktop / Creator-Medien | kalt | 33 → 17 | 515.571 → 162.786 |
| Desktop / Creator-Medien | warm | 33 → 17 | 515.181 → 10.436 |
| Mobil / Eventkarten | kalt | 31 → 18 | 438.991 → 208.074 |
| Mobil / Eventkarten | warm | 33 → 18 | 515.181 → 10.736 |
| Mobil / Top Shots | kalt | 27 → 17 | 355.413 → 162.786 |
| Mobil / Top Shots | warm | 33 → 17 | 515.181 → 10.436 |
| Mobil / Creator-Medien | kalt | 33 → 16 | 515.571 → 124.496 |
| Mobil / Creator-Medien | warm | 33 → 16 | 515.181 → 10.136 |

Neue Karten rufen keine vollständige Event-Medienliste ab. Die sichtbare Eventkartenmessung reduzierte die synthetischen Datenbankzugriffe auf Desktop von **58 auf 30**; auf Mobil wurden bei der Wiederholung **58 auf 19** Zugriffe benötigt. Die Startseiten-Thumbnail-Konvertierungen sanken bei warmem Servercache von mehreren Berechnungen pro Besuch auf null.

## Browser: Zeit bis zum sichtbaren Bild

Zeit seit Navigation in ms. „Erstes“ und „alle“ beziehen sich nur auf die tatsächlich sichtbaren Bilder der Zielreihe: vier Eventkarten beziehungsweise drei Medien auf Desktop (1600 × 1000), die erste Karte und den sichtbaren Anschnitt der zweiten auf Mobil (390 × 1000).

| Viewport / Reihe | Cache | Erstes Bild vorher → nachher | Alle sichtbaren Bilder vorher → nachher |
|---|---|---:|---:|
| Desktop / Eventkarten | kalt | 827 → 582 | 1.076 → 702 |
| Desktop / Eventkarten | warm | 291 → 417 | 618 → 518 |
| Desktop / Top Shots | kalt | 296 → 278 | 312 → 328 |
| Desktop / Top Shots | warm | 321 → 269 | 321 → 435 |
| Desktop / Creator-Medien | kalt | 526 → 299 | 560 → 333 |
| Desktop / Creator-Medien | warm | 563 → 273 | 579 → 391 |
| Mobil / Eventkarten | kalt | 621 → 623 | 803 → 671 |
| Mobil / Eventkarten | warm | 326 → 312 | 509 → 362 |
| Mobil / Top Shots | kalt | 273 → 298 | 306 → 348 |
| Mobil / Top Shots | warm | 244 → 237 | 261 → 304 |
| Mobil / Creator-Medien | kalt | 599 → 336 | 632 → 353 |
| Mobil / Creator-Medien | warm | 473 → 276 | 507 → 326 |

Die sichtbaren Eventkarten als Gruppe und Creator-Reihen werden deutlich früher vollständig dargestellt. Erste Top-Shots-Bilder erscheinen in mehreren vergleichbaren Messfällen früher, **nicht in jedem Fall**. Bei den übrigen Top-Shots-Bildern gibt es teilweise zusätzlichen Scroll-/Sichtbarkeits-Vorlauf, weil sie nicht mehr pauschal vorab geladen werden. Auch das erste warme Desktop-Eventbild war in dieser Stichprobe später, obwohl die gesamte sichtbare Reihe früher fertig war. Diese Gegenbeispiele sind ausdrücklich Teil des Ergebnisses, keine ausgeblendeten Messwerte.

## Verifikation und Wiederholung

- `npm run check`
- `npm run build`
- `node scripts/test-image-downloads.mjs --enable-uploads tests/home-thumbnail-existing.test.mjs tests/home-thumbnail-delivery.test.mjs tests/home-thumbnail-storage.test.mjs tests/thumbnail-cache.test.mjs tests/event-thumbnails.test.mjs tests/event-gallery-thumbnails.test.mjs tests/download-access.test.mjs tests/image-download-routes.test.mjs`
- `TEST_BASE_URL="https://$REPLIT_DEV_DOMAIN" node --import tsx --test tests/mobile-gallery-ui.test.mjs` gegen die laufende Vorschau; der breite Navigationstest wird getrennt von den Thumbnail-Checks des Produktionsbuilds ausgeführt.
- `node --import tsx scripts/benchmark-home-thumbnails.mjs after` nach abgeschlossenem Build und getrennt von Last-/Regressionstests.

Der bestehende Top-Shots-Test prüft weiterhin reale Anmeldung, Vorschau und Rechte gegen die kurzlebige Testdatenbank. Eigene Browserchecks prüfen Bildfehler-Kaskaden, keine vollständigen Medienlisten pro Karte, unabhängige Creator-Anfragen, Desktopbilder und nachgeladene horizontale Karten. Cachetests prüfen parallele Arbeit, Ablauf, Quellenänderungen, LRU-/Byte-/Eintragsgrenzen, nicht gecachte Fehler und unveränderte Qualitätsausgaben. Routenprüfungen widerrufen Sichtbarkeit, Premium-Freigabe, Safety-Version/-Policy, Eigentümerstatus, Verifizierung und bestehende Datensätze vor erneuten bedingten Abrufen.

Die Rohdaten liegen unter `generated-artifacts/home-thumbnails/{before,after}.json` und sind absichtlich nicht Teil von Git oder Veröffentlichung. Dieser Bericht hält die Vergleichswerte dauerhaft fest.

Abschließend bestanden **38 isolierte Prüfungen** sowie der **separat ausgeführte breite Mobiltest** mit nativen Wischgesten, Fotodialogen, Navigation und Desktop-Rastern. Typprüfung und Produktionsbuild bestanden. Der breite Mobiltest war im isolierten statischen Build-Fixture wechselnd bei Navigationssichtbarkeit/Scroll-Snap fehlgeschlagen; dieses Problem wurde nicht als bestandene Prüfung ausgegeben. Die fokussierten Thumbnail-Browserchecks und die Performance-Messungen verwenden weiterhin den echten Produktionsbuild.

Die abschließende echte Vorschau lief und zeigte mehrere Karten. Ein einzelner Thumbnail-Speicherabruf meldete dabei `502` / `Media storage upstream`; andere Karten und die Seite blieben nutzbar. Ursache und betroffener realer Datensatz sind mit den synthetischen Messungen nicht geklärt. Bestehende Medien wurden deshalb nicht umgeschrieben, gelöscht oder neu hochgeladen. Die lokale Messung ersetzt ausdrücklich keine Untersuchung dieses echten Storage-Abrufs.

## Nicht verändert

Keine Veröffentlichung, Production-Schreibzugriffe, Datenmigration, historische Medienänderung, neue Infrastruktur, Edge-Aktivierung in Production, neue Nutzungsanalyse, Download-Qualitätsänderung oder Änderung der Safety-/Rechteentscheidungen. Der Cache bleibt prozesslokal; Neustarts/andere Instanzen benötigen jeweils eigene erste Konvertierungen. Der bestehende Node/AWS-SDK-Hinweis ist unabhängig von dieser Änderung.
