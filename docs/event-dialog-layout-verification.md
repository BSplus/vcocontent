# Eventdialog: Leerraum- und Versionsprüfung

## Ergebnis (13. Oktober 2026)

Der große Leerraum aus dem gemeldeten Screenshot war im aktuellen Stand **nicht
reproduzierbar**. Es wurde kein neuer Layoutfix eingebaut: Der gemeinsame
Eventeditor verwendet bereits normalen Blockfluss. Globale Dialogregeln,
Importverhalten, Zugangsdaten und Eventdaten bleiben unverändert.

Separat geprüft wurden:

1. die laufende Vite-Vorschau über die Entwicklungsdomain;
2. ein frischer `npm run build`, lokal mit dem echten Produktions-HTML-Renderer
   und den gebauten CSS-/JS-Dateien bereitgestellt, ohne den Produktionsserver
   und seine Hintergrundjobs zu starten;
3. die öffentlich ausgelieferten Frontend-Dateien von
   `https://vco-content-studio.replit.app`.

Die öffentliche Adresse wurde über die Deployment-Informationen ermittelt.
Zum Prüfzeitpunkt referenzierte die veröffentlichte Seite
`/assets/index-BvU1W8B-.js`; der frisch gebaute Stand verwendet
`/assets/index-C5GAlmXb.js` und `/assets/index-Cneb1y7M.css`.
Das veröffentlichte JS enthält für den Eventeditor bereits
`block max-w-2xl max-h-[90dvh] overflow-y-auto`.
Die unterschiedlichen Bundle-Namen beweisen keinen alten Layoutfehler:
Alle drei Stände haben mit identischen Fixtures dieselbe Endgeometrie.
Es gibt daher **keinen Nachweis**, dass ein fehlender früherer Fix den
gemeldeten Screenshot erklärt.

## Szenarien und Messwerte

Je Stand neun Fälle: drei echte CSS-Viewportgrößen × drei Rollen-/Datenzustände:

- Admin: zwei gespeicherte Nextcloud-Quellen, eine mit gespeichertem Passwort,
  realistische Zähler, Status `partial`, fehlgeschlagenes Video und
  „Resume failed files“;
- Admin ohne gespeicherte Quellen;
- Creator ohne Nextcloud-Funktionen.

Die Quellen- und Fortschrittsantworten werden gezielt zurückgehalten und
getrennt freigegeben. Messungen erfolgen beim Öffnen (mit normalisierter
Animationsskalierung), nach Animation/Formularbefüllung, nach Quellenladen,
nach Laden des Importfehlers und nach lokalem Hinzufügen/Entfernen einer Quelle.

Endgeometrie im Fehlerzustand, identisch in Vorschau, Produktionsbuild und
veröffentlichten Frontend-Dateien:

| CSS-Viewport | Dialoghöhe | Scrollhöhe | Abstand unter Aktionen | Horizontaler Überlauf |
| --- | ---: | ---: | ---: | ---: |
| 1280 × 900 | 810 px | 3240 px | 25,125 px | 0 px |
| 1600 × 1800 | 1620 px | 3240 px | 25,125 px | 0 px |
| 390 × 844 | 759,594 px | 4236 px | 16,478 px | 0 px |

Die Abstände entsprechen 24 bzw. 16 px Innenabstand plus Rahmen/Rundung.
Das Formular endet ohne zusätzliche Fläche direkt an der Aktionszeile.
Geprüft werden tatsächliches Scrollende, Formularhöhe, Scrollhöhe,
Dialoggrenzen, Fokus-/Scroll-Erreichbarkeit aller sichtbaren Formularfelder
und Buttons einschließlich Schließen und Wiederaufnahme sowie Escape.
Kindcontainer und transformierte Vorfahren werden mitprotokolliert.

Der Test hängt nicht von `display: block` ab. Als negative Kontrolle wird im
Browser vorübergehend 600 px Formular-Innenabstand eingefügt: Die
Geometrieprüfung muss dann fehlschlagen. Anschließend wird der Eingriff entfernt
und erneut korrekte Geometrie geprüft.

## Schutz echter Daten und Grenzen

Alle `/api/*`-Anfragen werden im isolierten Browser abgefangen; eine synthetische
Admin-/Creator-Identität existiert ausschließlich in diesen Browserantworten.
Der Produktionsbuild-Fixtureserver weist nicht abgefangene API-Anfragen zurück.
Der Test prüft zusätzlich, dass alle abgefangenen Anfragen GETs sind und weder
Downloads noch Resume-Aufrufe vorkommen. Keine echten Events, Quellen,
Passwörter oder Importjobs wurden verändert; keine Veröffentlichung erfolgte.

Der Vergleich der veröffentlichten Version prüft die echten ausgelieferten
Frontend-Dateien **mit synthetischen Daten**, nicht den angemeldeten
Originaldialog oder seine Produktions-API-Antworten. Die konkrete Sitzung aus
dem Screenshot, deren Browser/Zoom und eventuell bereits geladene alte
Dateien bleiben offen. Ein Zusammenhang mit Browsercache oder Version ist
nicht bewiesen. Mobile ist Chromium-Emulation mit gemessenem CSS-Viewport,
kein physischer Smartphone-/Bildschirmtastaturtest.

## Wiederholen und Nachweise

```sh
npm run build
EVENT_LAYOUT_OUTPUT=generated-artifacts/event-dialog/preview \
  node --import tsx --test tests/event-dialog-layout.test.mjs
EVENT_LAYOUT_BUILD=1 EVENT_LAYOUT_OUTPUT=generated-artifacts/event-dialog/production-build \
  node --import tsx --test tests/event-dialog-layout.test.mjs
# Veröffentlichte Adresse vor einem erneuten Vergleich verifizieren:
TEST_BASE_URL=https://vco-content-studio.replit.app \
  EVENT_LAYOUT_OUTPUT=generated-artifacts/event-dialog/published-assets \
  node --import tsx --test tests/event-dialog-layout.test.mjs
node --import tsx --test --test-concurrency=1 \
  tests/event-save-ui.test.mjs tests/event-thumbnails-ui.test.mjs
```

Layout: jeweils 9/9 bestanden. Speicher-/Thumbnail-UI: im abschließenden,
seriellen Durchlauf 10/10 bestanden. Beim ersten Lauf parallel zu zwei
Layoutprüfungen verfehlte ein Thumbnail-Test die Schließbedingung; der einzelne
Wiederholungslauf und der vollständige serielle Lauf bestanden. Das ist kein
Beleg für einen Layoutfehler; es wurde keine Anwendungskorrektur daraus
abgeleitet. Build erfolgreich, mit bestehenden Browserslist-/Chunkgrößenwarnungen.

PNG-Screenshots pro abgeschlossenem Zustand und JSON-Geometrieprotokolle liegen
unter den oben genannten `generated-artifacts/event-dialog/`-Unterordnern.
Diese generierten Nachweise sind absichtlich von Git und Deployment
ausgeschlossen; sie werden mit den Befehlen neu erstellt. Visuell geprüft
wurden insbesondere Fehlerzustand auf Mobile im Produktionsbuild und in den
veröffentlichten Dateien sowie der hohe Desktopdialog in der Vorschau.
