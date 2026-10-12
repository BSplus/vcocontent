# Nummernevidenz und Verstap-Suche — 12 October 2026

## Status: verbesserter automatischer Prüfer mit bekannten Grenzen freigegeben

Der Betreiber hat **nur eine automatische Lösung** gewählt; ein zusätzlicher
manueller Nummernfreigabeschritt wurde nicht eingeführt. Der ursprüngliche
Pixel-/Kachelentwurf wurde nach der Abschlusskontrolle zurückgezogen: Eine
Zahlenmenge aus dem Gesamtbild kann eine Zahl am falschen Fahrzeug bestätigen.
Der aktuelle Entwicklungszweig prüft tatsächliche Fahrzeugausschnitte und
räumlich getrennte Beobachtungen. Die API-/Persistenzverträge funktionieren,
der zusätzliche pixelbasierte OCR-Kandidat erhält inzwischen „007“, verliert
jedoch „89“ in einer Wiederholung. Nach Offenlegung dieser Grenze hat der
Betreiber die gegenüber der bisherigen Erkennung bessere Lösung ausdrücklich
freigegeben: „Nicht kompliziert machen. Uns werden auch Nummern durchrutschen.“
Die Freigabe betrifft die Implementierung, **nicht** Veröffentlichung oder
Live-Korrekturen. Die älteren Zwischenstände unten bleiben als verworfene
Versuche dokumentiert. Keine Prüferwartung wurde gelockert.

Es gab keine Veröffentlichung, produktive Medien-/Referenzänderung oder
Bestands-Neuanalyse. Auch Videos, manuelle Zuordnungen, Captions und Tags wurden
nicht produktiv verändert.

## Verifizierte Herkunft und ausschließlich lesende Untersuchung

Die Deployment-Auskunft bestätigte die Herkunft
`https://vco-content-studio.replit.app`. Mit vorhandenem Plattformzugang und
dem vorhandenen Testkonto wurden Originale und Thumbnails gelesen.
Zugangsdaten und Sitzungscookies wurden weder protokolliert noch abgelegt.
Geschäftsdatenzugriffe waren GET-Abfragen bzw. schreibgeschützte
Produktionsdatenbank-Abfragen. Die Originale haben jeweils **3840 × 2160 Pixel**.

Die konkrete Suchabfrage ist `/api/media?q=verstap`. Zusätzliche echte GET-Abfragen
mit `fields=caption`, `fields=photographer`, `fields=tags` lieferten keinen dieser
drei Treffer; **nur `fields=identification` lieferte 643, 618 und 601**.
Die bereits öffentlichen JSON-Felder bestätigen dieselbe Ursache.

Alle drei Medien gehören zum offiziellen Event 224, IMSA Esports Global
Championship 2026, Round 2 — Sebring. Gespeicherte Analyse und aktuelle
Referenzen standen auf Referenzrevision 3; `identificationManual=false`.
Die automatischen Captions waren bereits kontextbezogen, nicht eindeutige
Entry-Matches. Keine Caption-/Tag-Korrektur ist daraus abzuleiten.

| Medium | Gespeicherte visuelle Beobachtung vor Referenzmatching | Gespeicherte Suchzuordnung | Originalbewertung und zulässiger Schluss |
| --- | --- | --- | --- |
| **618** | `01`, Team und Fahrer leer, generisches `Prototype`, BMW, IMSA; weiteres Fahrzeug unbekannt | `01`, BMW M Verstappen Sim Racing, BMW M Hybrid V8, registriertes Zweier-Lineup, `source=reference` | Exakt das grün/schwarze Prototypenbild aus dem gemeldeten Screenshot. Die vermeintliche Nasen-Nummer ist ein eingerahmtes **i** bei **FLIVERIES**; keine vollständige `01` wurde belegt. Weitere stilisierte Zeichen liefern keine vollständige Ersatznummer. **Nummer unbelegt; daraus abgeleitete Zuordnung nicht tragfähig. Kein anderes Team oder richtige Ersatznummer behauptet.** |
| **601** | `1`, Team/Fahrer leer, `Prototype Race Car`, Endurance Racing; weiteres Fahrzeug unbekannt | `1`, dasselbe Team/Modell/registrierte Lineup, `source=reference` | Anderes, violett/rotes Prototypenbild. Eine mögliche `1` am Fahrzeug ist plausibel; ihre historische Lesestelle ist nicht gespeichert. Kein sicher nachgewiesener falscher Datensatz. **Nicht pauschal entfernen.** |
| **643** | `1` und `63`, beide ohne visuelles Team/Lineup, generische Race Cars, Prototype | Erstes Fahrzeug `1` mit demselben Referenzteam/Modell/Lineup; zweites `63` visuell | Mehrere Fahrzeuge und ein Pace Car. Eine Nummer kann zu einem anderen Fahrzeug im Feld gehören; gespeicherte Beobachtungen haben keine Ortsdaten. Weder pauschal falsch noch sicher dem vordersten Fahrzeug zuzuordnen. **Keine Korrektur ohne separate Belegung.** |

### Gesicherte Zuordnungskette, nicht rekonstruierbare historische Details

In den gespeicherten rohen Analysebeobachtungen steht bei 618 bereits `01`,
bevor ein Team oder Fahrer eingetragen ist. Die wirksame Event-Entry-Referenz
(Dokument 48) enthält Nummer **1**, BMW M Verstappen Sim Racing, BMW M Hybrid V8
und ein registriertes Fahrer-Lineup. Die Inline-Event-Entry-Tabelle enthielt
keine entsprechende 1/01-Zeile; die Dokumentreferenz erklärt das Enrichment.

`normalizedNumber` normalisiert führende Nullen: **visuell gespeicherte 01 → 1
→ Referenzzeile → Team/Modell/registriertes Lineup → identification-Suchtreffer**.
Das erklärt den gespeicherten Treffer, nicht den exakten historischen KI-Fehler.
Die ursprüngliche Anbieterantwort, Lesbarkeits-/Verdeckungsflags, Nummernpanels,
Bildkoordinaten und genaue damalige Promptfassung sind nicht gespeichert.
Es ist daher unbekannt, welches Zeichen die damalige Erkennung tatsächlich
für `01` hielt. Das Original zeigt lediglich, warum `01` nicht ausreichend
belegt ist. Das Lineup ist **kein Beweis für abgebildete Personen**.

Original-SHA-256 (Originale bleiben in ignorierten Prüfartefakten, nicht Git):

- 618: `f38690d99ae959ff30b6a99040a42c7ffcf581b6babc051cfb343689dc4aecb4`
- 601: `7e1a684780338c27b258350ab692ae7f8dfc7b502e78b422f11a801d646ad947`
- 643: `f1e202ebf4fa496ddb98753559ca6e8534b058c35ac9d871c500eb77e28f3d93`

## Prüfmaterial und unveränderte Ziele

Die ursprünglichen 16 Prüfbilder und ihre Erwartungen wurden **nicht gelockert**.
Der aus dem geprüften Original erzeugte, begrenzte 618-Eingang wurde ergänzt:
`tests/fixtures/motorsport/live-618.webp`, SHA-256
`1478afdfd8572329503affe8bd1e205fb56c02268491b726b358108043ac0db2`.
Erwartung: Nummer, Team, Personen/Lineup und spezifische Klasse unbekannt;
kein neues Ersatzteam oder Ersatznummer. Die Hauptliste umfasst nun 17 Bilder;
gemeinsamer Manifest-SHA-256 der verglichenen Läufe:
`af87efa0bca15d55c20890c21d7f8cd484bdba41b2b745c560e9ff5c2f5b4c74`.

Zusätzlich gibt es einen **separaten synthetischen Positivkontrollsatz** in
`tests/fixtures/motorsport/controls.mjs`: Zwei deutlich gedruckte `007`-Panels
wurden auf Nase und Seite desselben autorisierten Stock-Car-Prüfbilds gelegt.
Direkte visuelle Prüfung erfolgte vor den Anbieterläufen. Das ist keine echte
Entry List, keine unabhängige Originalaufnahme und kein Sensitivitätsnachweis
für natürliche Rennfotos. Es prüft, ob klare vollständige Zahlen einschließlich
führender Nullen überhaupt erhalten bleiben. Es verändert nicht den
17-Bilder-Vergleich oder dessen Ziele. SHA-256 der Kontrollpixel:
`5b64517d7fe25ae442cf63b1c4509ce5ea538e80856033aed25984846caa2321`.

## Frühe begrenzte Kandidaten: alle verworfen

Der verwaltete Anbieter blieb erhalten. Die ursprüngliche Extraktion bleibt
`gpt-4.1-mini`, 1000 Tokens, 25 Sekunden, ohne SDK-Retries. Für die Experimente
wurden höchstens zwei zusätzliche Anfragen innerhalb derselben bestehenden
`withVisionBudget`-Belegung verwendet: unabhängige Bildlokalisierung und
erneute Lesung tatsächlich ausgeschnittener Originalpixel, je 20 Sekunden.
Weder globale Queue-Grenzen noch Videoerkennung wurden erhöht/geändert.
Ein Anbieterfehler beendet den Versuch ausdrücklich; kein Rückfall auf eine
ungeprüfte erste Nummer.

1. **Erstmodell liefert Panelkoordinaten, unabhängige Crop-Lesung:** verworfen.
   Koordinaten waren unzuverlässig, echte Nummern gingen verloren. Eine geänderte
   Erstaufforderung führte zudem zu neuen optionalen Identitätsbehauptungen.
2. **Unveränderte Erstextraktion, unprimierte gpt-4.1-Lokalisierung, Crop-Lesung
   durch gpt-4.1-mini:** im ersten Vergleich keine bekannten falschen Nummern.
   Eine Wiederholung bestätigte aber erneut die verdeckte **10**.
   **Verworfen trotz vorheriger positiver Sicherheitsergebnisse.**
3. **Zwei räumlich getrennte vollständige Panels desselben Fahrzeugs, zwei
   unabhängige Crop-Lesungen, exakte Zeichenfolge, keine Mehrheitsentscheidung:**
   verdeckte 10, Ganganzeige 5 und 618/01 blieben unbekannt; keine neue Nummern-,
   Klassen- oder Personenbehauptung. Allerdings gingen **alle fünf im
   Hauptsatz erwarteten richtigen Nummern** verloren, und selbst die
   synthetische **007** blieb unbekannt. **Ebenfalls verworfen.**

Die dritte Variante prüft getrennte Boxen, fahrzeugbezogene Gruppierung,
Bildgrenzen, Mindestgröße, exakte führende Nullen, doppelte Indizes und beide
Crop-Antworten. Eine begrenzte Toleranz für ungenaue Fahrzeugboxen änderte die
negative Positivkontrolle nicht. Modellkoordinaten und selbst gemeldete
Lesbarkeitsflags sind also auch zusammen kein ausreichend zuverlässiger
Positivnachweis.

### Ergebnisvergleich auf identischen Erstbeobachtungen

Für den isolierten Nummernvergleich wurden die **unveränderten Erstbeobachtungen
des Baselinesatzes** wiederverwendet. So kann ein stochastisch neu erzeugtes
Fahrzeug-/Klassenfeld nicht als Verbesserung des Nummernprüfers erscheinen.

| Ziel | Baseline | Letzte Zweipanel-Variante |
| --- | --- | --- |
| Verdeckt, sichtbarer Teil von 107 | Falsch `10` | Unbekannt |
| Cockpit-Ganganzeige | Falsch `5` | Unbekannt |
| Gemeldetes 618 | Falsch `01`, visuelles Branding `LIVERIES` | Nummer/Team unbekannt |
| Vollständig lesbare 107 und 5 im Mehrfahrzeugbild | Beide erhalten | Beide verloren |
| Vollständige 107 im Seitenbild | Erhalten | Verloren |
| Vollständige Stock-Car-89 | Erhalten | Verloren |
| Sichtbare 477 | Bereits verfehlt | Weiter verfehlt |
| Separate klare Doppel-007-Kontrolle | Erhalten | Verloren |

Vollständige Prüfziele: **4/17 Baseline, 4/17 letzte Variante**.
Der Kontrollsatz: **1/1 Baseline, 0/1 letzte Variante**.
Kein Ziel wurde gelockert und kein Fehl-Lauf als bestanden dargestellt.
Die vollständigen Evaluatoren beenden sich weiterhin mit Fehlerstatus, wenn
Nummern, Motivtags oder andere eingefrorene Erwartungen verfehlt werden.
Aus diesen kleinen gezielt ausgewählten Sätzen folgt keine Gesamtgenauigkeit.

Historische lokale ignorierte Berichte:
`generated-artifacts/recognition/numbers-{baseline,candidate,candidate-2,final}.json`,
`partial-retry.json`, `dual-panel-{candidate,final}.json`,
`zero-{baseline,candidate,final}.json`.
Quellhash des zuletzt gemessenen Nummernprüfers:
`8876c8f020327d26a854e5a67956cfa509e8594ad311df233526a08cbdd38136`.
Das ist der Quellhash der **verworfenen** Zweipanel-Variante, nicht der später
übernommenen Absicherung. Kein historisches Qualitätsresultat wurde aufgewertet.

## Zurückgezogener Zwischenstand: reale Pixel und feste Detailansichten

Die unveränderte Erstextraktion bleibt `gpt-4.1-mini`. Nur bereits dort gelesene
Nummern können bestätigt werden: Der Prüfer ergänzt keine neue Nummer und
übernimmt keine seiner eigenen Team-/Modell-/Klassen-/Personenbehauptungen.

1. **Konservative harte Pixel-Sperre:** Nahezu einfarbige neutrale Rechtecke
   mittlerer Helligkeit mit deutlichen Nähten an allen vier Seiten machen die
   Nummern des Bildes unbekannt. Sie wird auf den dekodierten RGB-Pixeln geprüft,
   toleriert kleine JPEG/WebP-Abweichungen und enthält weder Bild-Hashes noch
   festgelegte Nummern, Koordinaten oder Referenzeinträge. Andere Positionen,
   Größen und Grautöne sind separat getestet.
2. **Unabhängige Mehransichtslesung:** `gpt-5.6-terra`, mittlere Denkintensität,
   höchstens 4096 Completion-/Reasoning-Tokens, 35 Sekunden, keine SDK-Retries.
   Die Anfrage enthält das vollständige Bild und vier deterministische,
   überlappende Zwei-Drittel-Ausschnitte der Originalpixel. Es gibt keine von
   einem Modell behaupteten Crop-Koordinaten und keine Forderung nach zwei
   separat gedruckten Nummern.
3. **Exakte Übereinstimmung:** Gedruckte Zeichenfolge muss in Erstbeobachtung,
   Ganzbildlesung und mindestens einer Detailansicht identisch sein. Führende
   Nullen werden hier nicht normalisiert. Erst beim späteren Referenzmatching
   darf die vollständig belegte `007` zur Entry-Nummer `7` passen.
4. **Unbekannt statt Ergänzen:** Leere Detailantworten bleiben unbekannt;
   ungültige Indizes, unzulässige Glyphen oder unvollständige Antworten schlagen
   ausdrücklich fehl. Doppelte ursprüngliche Nummern auf mehreren
   Fahrzeugbeobachtungen werden nicht eindeutig zugeordnet. Es werden keine
   zusätzlichen Fahrzeugdatensätze erzeugt.
5. **Server-Provenienz:** Nur der Prüfer setzt `pixel-tiles-v1`. Die
   Erstparser übernehmen diesen Wert nicht aus einer Anbieterantwort.
   Historische Beobachtungen ohne passende Provenienz dürfen bei
   Wiederverwendung keine sichere Nummer/Team-/Lineup-Zuordnung erzeugen.
   Eine manuell geschützte Zuordnung bleibt unverändert.

Die Pixel-Sperre ist ein **Verdachtsfilter**, kein Beweis einer Bildbearbeitung:
Auch echte gleichförmige graue Objekte können sie auslösen. Sie fügt deshalb
keinen Redaktions-/Manipulations-Tag hinzu und behauptet keine Bearbeitung.
Zum Beispiel trifft sie auch bei 618 eine neutrale rechteckige Bildregion;
die semantische Begründung für dessen unbelegte `01` bleibt unabhängig davon
die direkt geprüfte Logo-Verwechslung. Der Filter erkennt nicht jede denkbare
farbige oder natürliche Verdeckung. Im Zweifel gehen Nummern verloren, niemals
entstehen daraus alternative Nummern oder Personenidentitäten.

### Identische Bildziele, nicht gelockerte Abnahme

Historischer vollständiger Vergleich des später zurückgezogenen Zwischenstands:

- verdeckte `10`, Cockpit-`5` und 618/`01`: **unbekannt**;
- 107 und 5 im Mehrfahrzeugbild, 107 im Seitenbild und Stock-Car-89: erhalten;
- separate deutlich gedruckte Doppel-007-Kontrolle: erhalten;
- **keine neu eingeführte unsichere Nummern-, Klassen- oder Personenbehauptung**;
- die bereits vor der Änderung verfehlte 477 bleibt verfehlt, nicht umgedeutet.

Vollständige eingefrorene Prüfziele: **5/17 statt 4/17**.
Separater Kontrollsatz: **1/1**. Bestehende Helmet-/Steering-Wheel-/Group-/GT-Car-
und andere Motivtag-Lücken bleiben außerhalb dieser Nummernkorrektur bestehen;
der vollständige Evaluator meldet sie weiterhin mit Fehlerstatus.
Die Prüfung der bekannten falschen Nummern und die Erhaltung der zuvor
korrekten Nummern dürfen nicht als vollständige Motivtag-Abnahme ausgegeben werden.

Zusätzlich wiederholt der begrenzte Stresslauf sechs unveränderte Fälle jeweils
dreimal: verdeckte Nummer, Ganganzeige, 618, Mehrfahrzeugbild, 89 und 007.
Er speichert vollständige Prüfabweichungen neben den getrennten
Nummern-/Identitätschecks. Frühere reine KI-Varianten lieferten erneut die
falsche 10 bzw. gelegentlich unbekannte 89/007 und wurden nicht als erfolgreich
umetikettiert. Die endgültige Kombination beseitigt die falsche 10 auch dann,
wenn eine Anbieterantwort sie behaupten würde.

Historischer Stresslauf: **17/18 Nummern-/Identitätschecks**, alle neun
Wiederholungen der drei falschen-Nummer-Fälle bestanden, keine falsche neue
Nummer/Identität. In einer von drei 007-Wiederholungen wurde die Nummer unbekannt
statt bestätigt. Das bleibt ein ausdrücklich gemeldeter Positivkontrollfehler
(Stressskript Exit 1), kein „PASS“ und keine gelockerte Erwartung. Die 1/1 des
separaten vollständigen Kontrollvergleichs wird dadurch nicht zu einer
Behauptung perfekter Wiederholbarkeit. Bei ausbleibender konsistenter Lesung
verzichtet die Anwendung konservativ auf die Zuordnung.

Historische lokale Berichte (kein Nachweis für den aktuellen Kandidaten):
`generated-artifacts/recognition/guard-final.json`,
`guard-final-zero.json`. Der spätere `tile-stress.json` wurde beim
fahrzeugbezogenen Versuch überschrieben und ist kein Bericht dieses Zwischenstands.
Gemessener Prüfer-SHA-256:
`a3ba7877ec56c37c43fb4595b08bc05512def16328df11bc623cb19bbe706c20`.
Gemessener Pixel-Sperren-SHA-256:
`33a9de27cc9c7c3eb6020d1b0449863857baac622f8925f4fa9d326875963454`.

Es bleibt bei höchstens **einer zusätzlichen verwalteten Anfrage** für ein
Bild mit vorgeschlagenen Nummern. Die vorhandene Vision-Budget-Belegung und
Queue-Grenzen bleiben erhalten; die maximale Anbieterzeit des normalen
Fotoanalysepfads ist 25 + 35 Sekunden. Bilder ohne vorgeschlagene Nummern
oder mit Pixel-Verdachtsmerkmal brauchen keine zusätzliche Anbieteranfrage.
Das schwerere Modell und fünf Bildansichten verursachen zusätzliche
KI-Kosten; eine genaue Kostenquote wurde nicht ermittelt. Veröffentlichung und
eine betriebliche Kosten-/Durchsatzbestätigung bedürfen separater Freigabe.

Reproduktion ist ausdrücklich kostenpflichtiger/verwalteter KI-Testbetrieb,
nicht Produktionsreanalyse:

```sh
node --import tsx scripts/evaluate-motorsport-recognition.mjs --live --baseline \
  --output generated-artifacts/recognition/new-baseline.json
node --import tsx scripts/evaluate-motorsport-recognition.mjs --live --audit-baseline \
  --compare generated-artifacts/recognition/new-baseline.json \
  --output generated-artifacts/recognition/new-candidate.json
# Derselbe Vergleich für den getrennten Positivkontrollsatz: zusätzlich --control.
node --import tsx scripts/stress-photo-number-evidence.mjs --live \
  --baseline generated-artifacts/recognition/new-baseline.json \
  --control-baseline generated-artifacts/recognition/control-baseline.json
```

## Fahrzeugbezogener Kandidat nach der Abschlusskontrolle — nicht abgenommen

Eine Ganzbild-/Kachel-Zahlenmenge konnte die Nummer eines anderen Autos als
Bestätigung nutzen. Der aktuelle Kandidat ersetzt diese Mengenprüfung durch
eine unabhängige, unprimierte **numerische Fahrzeuglokalisierung** und eine
weitere Lesung des Ganzbilds und der **tatsächlich ausgeschnittenen Fahrzeugpixel**.
Die schwachen ersten Modellpositionen allein waren zu unzuverlässig.

Die numerische Lokalisierung erzeugt eigene generische Beobachtungen, keine
neuen Team-, Klassen- oder Personenbehauptungen. Neue Zahlzeichenfolgen außerhalb
der ersten Vorschläge werden im normalen Fotoanalysepfad nicht ergänzt.
Schwache Fahrzeugbeschreibungen dürfen nur nach eindeutiger räumlicher Verbindung
zum selben Fahrzeug erhalten bleiben, nie über Zahlgleichheit. Unverifizierte
`referenceConstraints` sind ausschließlich negative Konflikthinweise:
Sie können einen Referenzmatch verhindern, bestätigen aber keine Identität und
sind ausdrücklich **keine Suchfelder**.

Der Prüfer ordnet Ganzbild-Fahrzeuge zunächst geometrisch zu, **bevor** er ihre
Nummern vergleicht: eindeutige Überschneidung der Fahrzeugregionen (IoU mindestens
0,5, Abstand zur zweitbesten mindestens 0,2), Nummernpanel mindestens zu 95 %
innerhalb beider Regionen, keine gleich gut passende weitere Erstbeobachtung.
Danach muss die exakte Zahl einschließlich führender Nullen auch im zugehörigen
Quellpixel-Crop vorkommen. Fehlende, widersprüchliche oder fremde Nummern bleiben
unbekannt. Der Vertragstest nutzt das echte unveränderte Mehrfahrzeug-Prüfbild:
**rote 107 vorne, grüne 5 hinten**, mit absichtlich fälschlich der roten 107
zugewiesener 5. Auch eine fehlerhafte Crop-Antwort „5“ darf die korrekte
Ganzbild-Zuordnung nicht überstimmen.

Nur der Server setzt `vehicle-crop-v1` und die dazugehörige gültige Fahrzeugregion.
Frühere `pixel-tiles-v1`-Nachweise sind kein fahrzeugbezogener Nachweis.
Manuelle Zuordnungen bleiben geschützt. Beide Fotoanalysewege, Caption-Erkennung
und Cache-Wiederverwendung sind im Entwicklungszweig entsprechend verdrahtet;
es wurde **keine Versionserhöhung für eine globale Bestands-Neuanalyse** ausgelöst.

Beide zusätzlichen Bildlesungen verwenden weiter den verwalteten
`gpt-5.6-terra`, mittlere Denkintensität, jeweils höchstens 4096 Tokens und keine
SDK-Retries. Lokalisierung höchstens 25 Sekunden, Crop-Prüfung 35 Sekunden;
zusammen mit der schwachen Erstextraktion sind das höchstens 25+25+35 Sekunden
Anbieterzeit. Die Caption-Nummernerkennung braucht nur die beiden numerischen
Stufen. Bestehende Queue-/Vision-Budget-Grenzen bleiben erhalten. Zusätzliche
Kosten wurden nicht als feste Quote ermittelt.

**Reale Qualitätsgrenze, nicht als PASS dargestellt:**

- Gleiche 17 Pixeldateien, unveränderte Erwartungen, eingefrorene erste
  Beobachtungen: **5/17 statt 4/17**. Bekannte falsche 10, Ganganzeige 5 und 618/01
  unbekannt; echte 107 und 5 im Mehrfahrzeugbild, Seiten-107 und Stock-Car-89 erhalten.
- Separate 007-Positivkontrolle im vollständigen Vergleich: **0/1**.
- Sechs Fälle × drei Wiederholungen: **16/18 Nummern-/Identitätschecks**.
  Alle neun Negativfälle bestanden; einmal 89 und einmal 007 unbekannt.
  Damit wurde 007 zwar in zwei Wiederholungen bestätigt, ist aber nicht zuverlässig
  erhalten. Das ist kein Ersatz für die fehlgeschlagene 0/1-Kontrolle.
- Keine neuen unsicheren Nummern-, spezifischen Klassen- oder Personenbehauptungen
  im eingefrorenen Vergleich; unveränderte Motivtag-Lücken und die alte 477-Lücke
  sind weiterhin Fehler, keine gelockerten Ziele.

Lokale, ignorierte Berichte: `vehicle-local-final2.json`,
`vehicle-local-final2-zero.json`, `tile-stress.json` im Verzeichnis
`generated-artifacts/recognition/`. Der Dateiname des Stressberichts ist historisch;
seine jüngsten Daten stammen vom Fahrzeug-Crop-Kandidaten.
Vollständige Vergleichs-/Stressskripte melden weiter Exit 1.
Die zusätzliche Geometrie-Verknüpfung schwacher Beschreibungstexte wurde danach
in Vertragsprüfungen getestet; sie behebt **nicht** den realen Positivkontrollfehler.

Dieser historische Zwischenstand der alleinigen KI-Lese-/Koordinatenstrategie
war damit **nicht abnahmefähig**.
Nächster konkreter automatischer Ansatz: einen pixelbasierten Nummernpanel-/
OCR-Detektor als unabhängige Quelle für Position und vollständige Ziffern prüfen,
bei weiterhin verwaltetem Hauptanbieter und unveränderten Prüfzielen. Das ist
eine neue untersuchte Methode, keine zugesagte fertige Verbesserung und keine
zusätzliche menschliche Nummernfreigabe.

Technische Verifikation dieses historischen Zwischenstands: **68 unterschiedliche
isolierte Tests bestanden, 0 ausgesetzt**, einschließlich beider Fotoanalysewege,
Such-/Persistenzfällen, Cache-Wiederverwendung und der unveränderten Video-Tests.
Die zuletzt ergänzten Fahrzeug-/Suchverträge wurden gezielt erneut ausgeführt.
`npm run check` und `git diff --check` bestanden. Nach dem Workflow-Neustart
läuft Port 5000, die öffentliche Startseite wurde visuell geprüft.
Angemeldete Ansichten wurden ausschließlich über Rollen-/API-Verträge geprüft,
nicht durch Anmeldung im Screenshot-Browser.
Diese technischen Erfolge **heben die fehlgeschlagene reale Qualitätsabnahme
nicht auf** und sind keine Freigabe zur Übernahme oder Veröffentlichung.

## Zusätzlicher pixelbasierter Prüfer: mit offengelegten Grenzen freigegeben

Nach Betreiberentscheidung wurde der vorhandene lokale Tesseract-Prüfer
untersucht, ohne neuen Anbieter, API-Zugang oder menschliche Nummernfreigabe.
Die reine Gesamtbild-OCR bzw. Weißflächen-Segmentierung war ungeeignet:
richtige Zahlen gingen verloren, Fahrzeugfarbe und Karosserie verbanden
Nummernflächen mit anderen Flächen. Diese Varianten werden nicht eingesetzt.

Der freigegebene Ansatz ist in beiden Foto-/Caption-Analysewegen aktiv.
Er segmentiert dunkle, annähernd gleich hohe Glyphen aus den tatsächlichen
Bildpixeln auf hellem Hintergrund. Zusammenhängende
Wortgruppen werden nicht als Zahlenpräfix abgeschnitten. Für die OCR werden nur
deren unveränderte Glyphformen auf weißem Hintergrund gerastert; das ist
Vorverarbeitung, **kein Beweis für eine Startnummer oder vollständiges Panel**.
Zwei OCR-Lesungen (PSM 6/7, Englisch, ohne Ziffern-Whitelist) müssen dieselbe
ganze Ziffernfolge mit mindestens 65 Konfidenz liefern. Das genügt weiterhin
nicht für eine Zuordnung.

Nur bei einem eindeutig lokalisierten Einzelwagen darf ein solches Pixelwort
mit vollständig darin liegender Quellregion ergänzen: beim Hauptfoto nur eine
bereits in der Erstbeobachtung enthaltene exakte Zeichenfolge; beim numerischen
Caption-Detektor nur dieselbe numerische Bedeutung, einschließlich gedruckter
führender Nullen. Andere Nummern und zusätzliche Fahrzeugidentitäten werden
nicht aus einer globalen OCR-Zahlenmenge übernommen. Der Mehrfahrzeugpfad
erhält keine solche OCR-Ergänzung.

Der unabhängige verwaltete Prüfer erhält **das unveränderte Gesamtbild, den
tatsächlichen Fahrzeugausschnitt und gegebenenfalls den unveränderten,
vergrößerten Quell-Glyphausschnitt**, niemals die für OCR freigestellte Rasterung
oder eine erwartete Nummer. Gesamtbild, Fahrzeug und gelieferter Ausschnitt
müssen exakt übereinstimmen; geometrische Eigentümerschaft bleibt vor
Ziffernvergleich maßgeblich. Ohne ausdrücklich gelieferten Ausschnitt sind
erfundene `panelReadings` ein Fehler, keine zusätzliche Bestätigung.

Pixel-Vorverarbeitung bleibt begrenzt auf 1536 × 1536, höchstens 512
Glyphkomponenten, sechs Vorschläge, zwei OCR-Lesungen je Vorschlag, ein
OCR-Thread und maximal fünf Sekunden Gesamt-OCR-Laufzeit. Prozesse haben
Einzelzeit-/Ausgabelimits und werden bei Überschreitung beendet. Fehler werden
ausdrücklich gemeldet, ohne ungeprüfte Nummern als Rückfall zu verwenden.
Tesseract war bereits in der Projekt-Nix-Konfiguration enthalten. Die
bestehenden Vision-Slots und verwalteten Modelle wurden nicht erhöht.
Der experimentelle Provenienzmarker wurde wegen geänderter Semantik auf
`vehicle-crop-v2` geändert; kein globales Neu-Analyse-Fingerprint-Upgrade.

Bildboxen erwiesen sich weiterhin als unzuverlässig. Explizite tatsächliche
Bildabmessungen und getrennte Normalisierung beider Achsen wurden deshalb in
beiden Modellaufforderungen ergänzt. Dies ist **keine Messung und kein Beweis**;
die räumlichen Prüfgrenzen und eingefrorenen Erwartungen bleiben unverändert.

Letzter begrenzter Vergleich:

- Unveränderte 17 Zielbilder und Baseline-Erstbeobachtungen: **5/17 vollständige
  Prüfziele bestanden** gegenüber 4/17 Baseline. Bekannte falsche 10, Cockpit-5
  und 618/01 bleiben unbekannt. Die erwarteten 107/5, Seiten-107 und 89 wurden
  in diesem Durchlauf erhalten. Alte Motivtag-/477-Lücken bleiben Fehler.
- Separate unveränderte Doppel-007-Kontrolle: **1/1**, exakte `007`, keine neue
  Klasse oder Personenbehauptung.
- Sechs entscheidende Bilder × drei Wiederholungen: **17/18**, alle neun
  Negativprüfungen bestanden, 007 dreimal erhalten, 107/5 dreimal erhalten.
  **89 nur zweimal erhalten, einmal unbekannt. Nicht als 18/18 oder als
  perfekte Erkennung ausgegeben.**
- **72 unterschiedliche isolierte Tests bestanden, 0 ausgesetzt**; darunter
  drei echte lokale OCR-Prüfungen (unveränderte 007, andere Positionen/Nummern
  001 und 1007 ohne Präfixkürzung, Logo/Verdeckung/Ganganzeige). Die übrigen
  Anbieter-Verträge sind weiterhin künstlich und kein Genauigkeitsbeweis.
  Typprüfung und Produktionsbuild bestanden.

Ignorierte Berichte: `ocr-dimensions.json`, `ocr-dimensions-zero.json` und
`tile-stress.json` unter `generated-artifacts/recognition/`. Quellhashes von
Nummernprüfung, Lokalisierer und Pixel-OCR sind im Bericht enthalten; der
historische Stress-Dateiname bedeutet keine Anwendung der verworfenen Kacheln.
Die Evaluatoren melden wegen unveränderter verfehlter Ziele weiterhin Exit 1.
Der OCR-Zweig wurde zunächst hinter ein Prüf-Opt-in gelegt und nach der
ausdrücklichen Betreiberfreigabe aktiviert. Die berichteten Quellhashes
beziehen sich auf den gemessenen Stand vor dieser Schnittstellenänderung.
Danach wurde ausschließlich das Einzelprozess-Zeitlimit auf höchstens drei
Sekunden erweitert; fünf Sekunden Gesamt-OCR-Laufzeit und alle fachlichen
Prüfregeln bleiben unverändert.

**Freigegebene Verbesserung, keine fehlerfreie Nummernerkennung.** Die
zusätzliche OCR-Methode behebt die führenden Nullen im geprüften Kontrollbild,
löst aber den durchgehend verlässlichen Erhalt konturierter bzw. schräg
abgebildeter Nummern nicht. Der Betreiber akzeptiert verbleibende Auslassungen
und mögliche Fehlablesungen zugunsten dieser nachgewiesenen Verbesserung.
Weitere Modellforschung ist keine Voraussetzung dieser Freigabe und wird
nicht fortgesetzt. Die bekannten falschen Fälle dürfen weiter unbekannt
bleiben; sie wurden nicht mit einer Ersatznummer oder anderem Team gefüllt.

## Isolierte Such-, Persistenz- und Vertragsprüfungen

Tests verwenden den temporären lokalen PostgreSQL-Testtransport, **nicht die
verbundene Produktionsdatenbank**. Der Verstap-Suchtest speichert die historische
Kette 01 → 1 → Referenzteam/Lineup, weist den falschen Treffer vor einer
isolierten Korrektur nach und prüft seinen Wegfall danach. Berechtigte visuelle
und manuelle Zuordnungen bleiben bei `verstap`, `versta`, `VERSTAPPEN` und `stapp`
auffindbar. Caption, Fotograf und Tags sind getrennte Suchfelder; das Such-SQL
wurde nicht eingeschränkt und Referenzzuordnungen nicht pauschal entfernt.

Die Verträge testen einzelne/verdeckt gelesene Panels, Pixel-Sperren,
Dashboard-/Logo-Nummern, tatsächliche Fahrzeug-Crops, mehrere Fahrzeuge,
führende Nullen, doppelte Fahrzeugnummern, fehlerhafte Indizes/Antworten,
geschützte manuelle Daten und unvertrauenswürdige historische Erkennungen.
Ihre Anbieterantworten sind **künstlich**. Sie belegen keine visuelle Genauigkeit.

Der isolierte Ende-zu-Ende-Test führt jetzt beide Fotoanalysewege aus, reproduziert
vorher den falschen Treffer und prüft nachher unbekannte Nummer, Team und Lineup
sowie unveränderte geschützte Captions/Tags. Anschließend setzt er ausschließlich
in der temporären Datenbank eine historische ungeprüfte Beobachtung ein und
weist nach, dass Referenzrevision und Caption-Vorschau sie nicht erneut zum
Verstappen-Treffer aufwerten. Wiederverwendung macht keine verdeckte automatische
Bestands-Neuanalyse; explizite Reanalyse ausgewählter Bilder kann neue
Pixel-Provenienz erwerben. Der Analyse-Fingerprint wurde bewusst nicht global
erhöht. Persistierte bestehende Live-Zuordnungen werden nicht durch Suchfilter
entfernt oder hier automatisch überschrieben.

## Gezielte Betreiberempfehlung: nur 618, noch keine Freigabe

**Nur für Medium 618** ist eine begrenzte Korrektur der unbelegten automatischen
Nummer und ihrer abgeleiteten Identitätsfelder gerechtfertigt:

1. Betreiber muss die Änderung dieses Datensatzes ausdrücklich freigeben.
   Unmittelbar vorher aktuellen Datensatz und Analysebeobachtungen sichern und
   prüfen, dass inzwischen keine manuelle Bearbeitung erfolgt ist.
2. Die automatische `01` unbekannt setzen; davon abgeleitetes Team, registriertes
   Lineup und spezifisches Referenzmodell entfernen. Keine andere Nummer oder
   Teamzuordnung einsetzen. Unabhängig belegte visuelle Beschreibung kann nach
   Betreiberprüfung erhalten bleiben.
3. Auch die zugehörige gespeicherte automatische Analysebeobachtung bzw. deren
   Wiederverwendung gezielt absichern, sonst kann die alte `01` erneut
   Referenzmatching auslösen. Keine globale Neuinterpretation alter Jobs.
4. Geschützte manuelle Zuordnungen, Captions, Tags und den zweiten unbekannten
   Fahrzeugeintrag nicht ersetzen. Danach lesend Suchfeld und gespeicherten
   Zustand kontrollieren.
5. Für **601 und 643 keine Entfernung empfohlen**. Weitere bildbezogene Belegung
   wäre erforderlich; ihre gespeicherten Teamtreffer sind nicht nachweislich
   falsch. Ein registriertes Lineup identifiziert keine abgebildeten Personen.

Diese Empfehlung wurde **nicht ausgeführt**. Eine Datensatzkorrektur erlaubt
weder eine Veröffentlichung noch eine Bestands-Neuanalyse.

## Freigabegrenzen

Technische Prüfung des zurückgezogenen Zwischenstands: `npm run check`, **66 isolierte Tests bestanden, 0 ausgesetzt**,
`npm run build` und `git diff --check` erfolgreich. Der lokale Runner verwendet
eine temporäre PostgreSQL-Datenbank, nicht die verbundene Entwicklungs- oder
Produktionsdatenbank. Nach einem Workflow-Neustart startet Port 5000 sauber;
die öffentliche Startseite wurde visuell geprüft. Angemeldete Ansichten wurden
über Rollen-/API-Tests, nicht durch Anmeldung im Screenshot-Browser geprüft.

Es wurden ausschließlich automatische Kandidaten untersucht. Bestehende
manuelle Bearbeitung bleibt möglich und geschützt, aber keine zusätzliche
menschliche Freigabe wird vorausgesetzt. Die gezielte Live-Korrektur von 618,
Veröffentlichung, Bestands-Neuanalyse und eine produktive Kosten-/Durchsatzprüfung
sind nicht durchgeführt. Die Positiv- und Negativziele bleiben für künftige
Änderungen verbindlich; die dokumentierten alten Motivtag-/477-Lücken werden
nicht nachträglich aus der Prüfung entfernt.
