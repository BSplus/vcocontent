# Sebring: Startnummern, Caption-Auslassungen und Live-Jobs

Lesende Prüfung am **13 October 2026, 16:27–16:30 UTC**. Keine Änderungen an
Live-Medien, Referenzen, Einstellungen oder Queue; keine neuen Analysen,
Anbieteraufrufe oder Veröffentlichung. Nur dieser Event, keine Bestandsanalyse.

**Spätere, separat beauftragte Codeänderung:** Der Betreiber hat nach dieser
Diagnose festgelegt: „Nummern mit matching entry list sollen die sicheren infos
aus entry list erhalten“. Der unten dokumentierte Live-Befund bleibt eine
historische Momentaufnahme, kein Zustand nach einer produktiven Korrektur.
Die Software nennt nun ausschließlich sicher referenzzugeordnete Fahrzeuge,
auch neben unbekannten Autos. Passendes Herstellerbranding und eindeutig
normalisierbare Teamkurzformen blockieren den nummerngestützten Match nicht mehr.
Echte Konflikte, vollständige fahrzeuggebundene Nummernevidenz, Referenzgrenzen
und Textschutz bleiben erhalten. Keine Veröffentlichung oder Live-Neuanalyse.
Die Diagnosetests prüfen jetzt diese neue Sollregel statt den damaligen Fehler.
Die Codeänderung wurde typgeprüft und durch isolierte Matching-/Captiontests
sowie Worker-, Referenz-API- und manuelle Zuordnungstests auf einer ausschließlich
temporären lokalen Datenbank abgesichert. Ein bestehender OCR-Test scheiterte
einmal an der unveränderten begrenzten OCR-Ausführung und bestand isoliert
erneut; die OCR-Fristen oder Evidenzregeln wurden nicht aufgeweicht.
Der abschließende gemeinsame Prüflauf besteht vollständig: **71 Tests,
0 Fehler, 0 übersprungen**, einschließlich des Worker-Speicherwegs mit
bekanntem plus unbekanntem Fahrzeug.

## Kurzantwort

**Warten allein dürfte die betroffenen Captions nicht ändern.** Im geprüften
Event ist nichts mehr queued/running. Die fehlenden Angaben haben mehrere
Ursachen: abgeschlossene Tag-only-Jobs, terminal fehlgeschlagene Fotoanalysen,
fehlende gespeicherte Nummernevidenz, ein exakter Teamnamen-Veto und eine
Alles-oder-nichts-Regel für automatische Mehrfahrzeug-Captions.

Eine sichtbare Nummer, eine gespeicherte geprüfte Nummer, eine gültige
Referenzzuordnung und eine Fahrzeugangabe in der Caption sind vier verschiedene
Zustände. `no_unique_match` ist kein Nachweis für eine laufende Analyse oder
eine nicht erkannte Nummer.

## Quellen und Zugangsgrenzen

- Produktionsadresse durch aktuelle Deployment-Metadaten bestätigt:
  `https://vco-content-studio.replit.app`; erfolgreiche VM-Veröffentlichung,
  öffentlich erreichbar.
- Berechtigter **read-only Produktionsdatenbankzugang** war verfügbar.
  Event- und Jobzustände stammen von dort, nicht aus der Workspace-Datenbank.
  Die SQL-Abfragen wurden mit `environment: "production"` ausgeführt.
- Öffentliche Event-/Medien-GETs und tatsächlich geladene Vorschaupixel;
  für vier kleine Bildvergleiche zusätzlich normale App-Anmeldung mit dem
  vorhandenen Testzugang und autorisierte GETs der Originaldateien.
  Keine Umgehung von Authentifizierung. Die Anmeldung erzeugt eine normale
  Sitzung, verändert aber keine geprüften Inhalts-/Queuezustände.
- Keine `/download`-Requests, Downloadfreigaben oder gezählten Downloads.
  Originale ausschließlich über die berechtigte `/api/media/files/…`-Leseroute;
  unveränderte Ausschnitte aus Originalpixeln, keine KI-Bildbearbeitung.
  Temporäre Bilder liegen im ignorierten `generated-artifacts/`-Verzeichnis.
- Anonyme GETs auf `/api/events/227/photo-matching` und
  `/api/media/926/analysis` lieferten weiterhin **401**. Das ist keine offene
  Queuezugangsgrenze dieser Prüfung, da die Produktionsdatenbank zugänglich war.
  Ein API-only-Betrachter könnte daraus dagegen keine Queuezustände ableiten.
- Die genaue ausgelieferte Quellcodefassung wurde nicht unabhängig aus dem
  Deployment extrahiert. Lokale deterministische Funktionsreproduktionen erklären
  die beobachteten gespeicherten Resultate, beweisen aber keinen Build-Hash.
  Die Live-Captions enthalten zusätzlich zum Seriennamen den Eventtitel;
  der lokale Caption-Kontext setzt diese beiden Felder nicht gleichzeitig ein.
  Dieser Kontextunterschied ist kein Beleg für die untersuchten Nummerauslassungen.

## Frische Verteilung

Event **227**, „IMSA Esports Global Championship 2026, Round 2, Sebring“,
Eventdatum **11 October 2026**, ist der einzige aktuell veröffentlichte,
nicht administrativ versteckte Event in der abgefragten Liste.
Serie 1, Saison 2026, offizieller Event ohne Creator; Photo matching **an**,
Matchingrevision **1**, Referenzrevision **2**. Plattform ist leer.

| Gespeichertes Ergebnis | Fotos |
| --- | ---: |
| `photo_automatic` / `matched` | 19 |
| `photo_automatic` / `no_unique_match` | 111 |
| `nextcloud_placeholder` / noch kein Matchstatus | 7 |
| **Gesamt** | **137** |
| Mindestens eine gespeicherte Nummer | 76 |
| Gespeicherte Nummer, aber keine `#Nummer` in Caption | 57 |
| Davon mindestens eine `source=reference`-Zuordnung | 17 |

Diese Werte bestätigen die Ausgangsabfrage; sie sind **keine visuell ermittelte
Erkennungsquote**. Nummern wurden über `identification` und das Fehlen von
`#[0-9]` im Captiontext gezählt, nicht über Dateinamen oder Tags.

Jobabfrage **16:27:16 UTC**: **133 completed, 4 failed, 0 queued,
0 running, 0 not_requested**. Eine weitere Abfrage um **16:27:49 UTC**
prüfte auch den effektiven, durch Referenzrevisionen abgeleiteten Queuestatus:
ebenfalls **133 completed, 4 failed**, keine ausstehenden Referenzjobs.
Die separate Zeitangabe ist wichtig: die Abfragen sind keine gemeinsame
transaktionale Momentaufnahme.

## Sieben Platzhalter separat

Zeiten unten UTC, 13 October 2026. `available_at` bei einem failed-Job ist
kein Beweis für einen bevorstehenden automatischen Retry.

| Foto | Job | Versuche | Letztes Update | Befund |
| --- | --- | ---: | --- | --- |
| 799 | completed | 1 | 15:25:06.648 | Tag-only; `photo_workflow=false`, Matchingrevision 0, `recognition=null`; Dateiname bleibt. |
| 800 | completed | 1 | 15:25:12.677 | Derselbe Tag-only-Zustand. |
| 801 | completed | 1 | 15:25:18.984 | Derselbe Tag-only-Zustand. |
| 887 | failed | 3 | 16:01:06.699 | Foto-Workflow an, Matchingrevision 1; keine gespeicherte Erkennung. |
| 931 | failed | 3 | 16:01:37.266 | Derselbe terminale Fehlerzustand. |
| 932 | failed | 3 | 16:02:09.921 | Derselbe terminale Fehlerzustand. |
| 933 | failed | 3 | 16:02:40.853 | Derselbe terminale Fehlerzustand. |

Bei 799–801 steht der Job auf Referenzrevision 1 statt 2, aber
**`recognition=null`**: damit entsteht kein automatischer Referenz-Rematch.
Der separat geprüfte Fingerprint-Präfix ist bei allen drei `tags`; generierte
Tags sind vorhanden. Bei den vier fehlgeschlagenen Jobs lautet er `recognition`,
ohne gespeicherte generierte Tags.
Der Zustand zeigt abgeschlossene Tag-Analysen ohne Foto-Matchingauftrag,
nicht drei noch laufende Fotoanalysen. Aus dem Zustand allein lässt sich die
gesamte frühere Folge von Import und Opt-in nicht beweisen.

887/931/932/933 haben `reference_revision=0`, Generation 1 und den Fehler:
`AI analysis failed. Your media and manual tags are safe; retry is available.`
Gespeicherte letzte Laufzeiten: 22.802 / 29.386 / 31.465 / 29.749 Sekunden.
Die vier `available_at`-Zeiten sind 16:01:51.699 / 16:02:22.266 /
16:02:54.921 / 16:03:25.853. **Status bleibt failed**; die Worker-Auswahl
nimmt keine failed-Jobs. Anbieterursache oder interne Fehlerstufe sind
aus diesem generischen Fehler nicht bestimmbar; insbesondere beweisen die
Laufzeiten allein keinen Timeout. Keine Wiederholung gestartet.

## Gültige Referenzen, nicht nur vermutete Teamnamen

Die Produktionsabfrage fand genau **ein** gültiges Dokument: **49**,
`2026_IEGC_Round 2_Entry List_OFFICIAL.pdf`, Eventscope, Art `entry`,
keine Sessioneinschränkung, Update **15:24:50.175 UTC**. Es umfasst **52**
Zeilen. Keine passende offizielle Saisonreferenz und keine Legacy-Zeile
in `event_entries` für diesen Event.

| Nummer | Team aus tatsächlicher Referenz | Fahrzeug |
| --- | --- | --- |
| 91 | Porsche Coanda Esports Racing Team | Porsche 963 GTP |
| 132 | Bleu Mercure Esport | Porsche 911 GT3 R (992) |
| 7 | Grid-and-Go.com eSports | Aston Martin Valkyrie |

Für diese Nummern liegt jeweils genau eine Zeile vor. Die untersuchten Fotos
haben keine Sessionzuweisung. Damit erklären hier weder doppelte Referenzen,
Saison-/Ownergrenzen noch eine Sessionblockade die Auslassungen.
Registrierte Lineups werden nicht als Nachweis abgebildeter Personen gewertet.

## Kleine visuell geprüfte Auswahl

### Erkannte Nummer, aber Referenzmatching blockiert

| Foto | Tatsächlich geprüfte Pixel | Gespeichertes Ergebnis | Nachweisbare Auslassungsursache |
| --- | --- | --- | --- |
| 926 | Vorschau 360×640: vollständige **91** auf der Nase; Porsche-Schrift am Heckflügel. | 91, `vehicle-crop-v2`, gültige Fahrzeugregion, `source=visual`; schwaches Teamhint **Porsche**. | Exakter Teamvergleich mit **Porsche Coanda Esports Racing Team** schlägt fehl. Herstellerhint ist nicht der Konflikt, da Referenzhersteller leer ist. |
| 927 | Vorschau 360×640: vollständige **91** seitlich; keine Nummer des Mobil-1-Turms als Fahrzeugnummer verwendet. | 91 mit Evidenz; Hint Team **Porsche**, Fahrzeug **Porsche 963**, Hersteller Porsche. | Derselbe Team-Veto. `Porsche 963` ist mit `Porsche 963 GTP` als Teilbeschreibung kompatibel. |
| 920 | Vorschau 360×640: vollständige **132** auf der Nase, „bleu mercure“ am Flügel. | 132 mit Evidenz; Teamhint **bleu mercure**, Fahrzeug/Hersteller Porsche. | **bleu mercure** ≠ **Bleu Mercure Esport** nach Trim/Lowercase. |
| 922 | Vorschau 640×360: vollständige **132** auf der Nase, Teamschrift am Flügel. | 132 mit Evidenz; Teamhint **bleu mercure**, Fahrzeug leer, Hersteller Porsche. | Derselbe exakte Team-Veto, nicht fehlende Nummer oder unbekannte Referenz. |

Die Hints stehen in `referenceConstraints`, während das sichtbare Teamfeld
leer ist. Auch solche schwachen, nicht als Identitätsbeweis geltenden Hints
werden als **Veto** geprüft. Hersteller- oder Sponsorbranding darf deshalb
nicht einfach als neue sichere Teamidentität übernommen werden.

### Erfolgreiche 91-Kontrollen

- **925:** öffentliches Übersichtsbild plus autorisiertes Original **3840×2160**.
  Unveränderter Fahrzeugausschnitt zeigt vollständige **91** sowohl auf Nase
  als auch Seite. Gespeichert: 91, geprüfte Evidenz, `source=reference`,
  `matched` und Caption mit `#91 Porsche Coanda Esports Racing Team`.
- **928:** Vorschau **640×360** zeigt vollständige **91** auf dem seitlichen
  Panel. Dieselbe erfolgreiche Referenzzuordnung und Caption.
- Beide besitzen ein Herstellerhint Porsche, **aber kein Teamhint Porsche**.
  Die Referenz existiert und kann funktionieren; die anderen 91-Fälle sind
  nicht grundsätzlich wegen der Nummer, Fahrzeugbezeichnung oder eines
  fehlenden Entry-Imports blockiert.

### Referenzzugeordnetes Fahrzeug, Caption trotzdem unterdrückt

- **894:** Vorschau zeigt zwei Fahrzeuge. Autorisiertes Original **3840×2160**
  und unveränderter Ausschnitt des rechten/vorderen Prototyps zeigen die
  vollständige **7**. Gespeichert: dieses Fahrzeug ist mit Evidenz zu
  **Grid-and-Go.com eSports / Aston Martin Valkyrie** zugeordnet; das linke
  Fahrzeug bleibt nummernlos/visuell. Die automatische Caption enthält
  **keine** Fahrzeugangabe.
- **906:** Vorschau **640×360** zeigt vorne die vollständige **91** auf dem
  seitlichen Panel, zwei kleinere Begleitfahrzeuge im Hintergrund. Gespeichert:
  die 91 ist mit Evidenz zu **Porsche Coanda Esports Racing Team / Porsche 963
  GTP** zugeordnet; die beiden anderen Beobachtungen bleiben unbekannt.
  Auch hier nur Eventkontext in der Caption.

`matchedPhotoCaption` fordert für automatische Captions, dass **jede**
Beobachtung eine nummerierte Referenz mit Team ist. Ein gültiger Einzelmatch
plus eine unbekannte Beobachtung setzt `matched=false`: Fahrzeugtexte werden
vollständig weggelassen. Der Statusname `no_unique_match` verdeckt in diesen
Fällen einen bereits vorhandenen gültigen Einzelmatch. Das manuell bestätigte
Sonderverhalten darf nicht als automatischer Ausweg aktiviert werden.

### Fehlende gespeicherte Nummer und Grenze zwischen Erkennung und Verwerfung

- **921:** Vorschau und autorisiertes Original **3840×2160** zeigen auf der
  Seite unzweifelhaft die vollständige **132**, einschließlich beider
  Panelränder. In **Job-Erkennung und öffentlicher Identifikation** steht
  dagegen `number=""`, ohne `vehicleRegion`, ohne Evidenz und ohne Constraints.
  Der Job ist completed (Update **16:05:35.936 UTC**), kein ausstehender Job.
  **Bestätigter sichtbarer Nummernverlust**, aber die genaue Stufe ist offen.
- **935:** Vorschau zeigt Rauch und mehrere Fahrzeuge. Im autorisierten
  Originalausschnitt sind Ziffernfragmente bzw. Nummern unter Rauch erkennbar;
  eine vollständige Nummer mit sicher sichtbaren beiden Panelenden wird hier
  **nicht bestätigt**. Alle drei gespeicherten Beobachtungen haben eine
  Fahrzeugregion, aber leere Nummern. Diese Geometrie ist mit durchlaufener
  Lokalisierung vereinbar; sie beweist nicht, welche Kandidaten vorgeschlagen
  oder im Audit verworfen wurden. Keine falsche Referenzzuordnung empfohlen.
- **929:** ergänzend geprüfte Startfeld-Vorschau **640×360**; kleine,
  unscharfe/überlagerte Panels erlauben hier keine sichere vollständige
  Nummernlesung. Gespeichert sind zwei generische, nummernlose Beobachtungen.
  Kein Beleg, dass sämtliche sichtbaren Fahrzeuge vollständig erfasst wurden.

**Nicht gespeichert** sind die ursprüngliche schwache Antwort mit
`numberReadable`/`numberObscured`, die Lokalisierungsantwort und unabhängige
Full-image-/Crop-Readings sowie die einzelnen Ablehnungsgründe. `j.recognition`
ist bereits das Ergebnis **nach** der Evidenzprüfung, kein Rohprotokoll.
Deshalb lässt sich bei 921 nicht beweisen, ob die Nummer schon in der ersten
Extraktion fehlte, bei der zulässigen Nummernmenge verloren ging, keine Region
erhielt oder im unabhängigen Audit abgelehnt wurde. **Verworfene Evidenz ist
eine mögliche, nicht bestätigte Ursache.** Die ausgewählte Stichprobe darf
nicht auf alle 61 nummernlosen Fotos hochgerechnet werden.

## Verarbeitungskette und Schutzbedingungen

1. `parseRecognition`: nur vollständige 1–4 Ziffern mit Lesbarkeitsflag und ohne
   Verdeckungsflag. Klassenmarkierungen getrennt; keine Fahreridentifikation.
2. `localizePhotoNumbers`: wird im Foto-Erkennungspfad nur aufgerufen, wenn
   mindestens ein erster Nummernvorschlag existiert. Lokalisierte Nummern
   müssen in dieser Vorschlagsmenge sein; OCR ist begrenzt und fahrzeuggebunden.
   Fehlt der erste Vorschlag vollständig, kann dieser Pfad ihn nicht nachholen.
   Das ist ein belegter Codepfad, **nicht** die belegte historische Stufe von 921.
3. `verifyPhotoObservations`: unabhängig gelesene vollständige Nummer im
   Gesamtbild und tatsächlichem Fahrzeugausschnitt, bei geliefertem Panelcrop
   auch dort; eindeutige Geometrie, Panelzugehörigkeit, keine Übertragung zwischen
   Fahrzeugen. Abgelehnte Nummern werden geleert. Nur danach `vehicle-crop-v2`.
4. `matchReferences`: passende Event-/Saison-/Owner-/Sessionreferenz;
   eindeutige Referenz, kompatibles Fahrzeug und strikter Team-/Hersteller-Veto.
   Fall-/Trimnormalisierung bedeutet **keine** Kurznamens-/Sponsoraliasprüfung.
5. `matchedPhotoCaption`: automatische Fahrzeugtexte nur bei vollständiger
   Referenzdeckung aller Beobachtungen. Mehrere gültige Matches sind erlaubt;
   ein einzelnes unbekanntes Fahrzeug verhindert alle Fahrzeugtexte.
6. Worker ersetzt nur zulässige automatische/Platzhalter-Captions bzw.
   ausdrücklich ausgewählte unveränderte preserved-Texte. Manuelle
   Identifikation und geschützte Texte bleiben geschützt. Alle acht
   Hauptvergleichsfotos haben `identification_manual=false` und
   `caption_source=photo_automatic`; Textschutz erklärt diese Auslassungen nicht.
   Ihre möglichen Fahrzeugtexte liegen klar unter 1000 Zeichen; kein Längenrückfall.
7. Abgeschlossene Erkennung kann nur bei neuer Referenzrevision automatisch
   rematchen; failed-Jobs und Jobs ohne Erkennung werden dadurch nicht repariert.
   Neue Einstellungen/Referenzen wurden in dieser Prüfung **nicht** geändert.

Vergleichsjobs stehen auf Referenzrevision 2 und Matchingrevision 1, ohne Fehler:

| Foto | Status | Versuche | Generation | Letztes Update UTC |
| --- | --- | ---: | ---: | --- |
| 894 | completed | 1 | 2 | 16:04:54.984 |
| 906 | completed | 1 | 2 | 16:05:13.215 |
| 920 | completed | 1 | 2 | 16:05:34.424 |
| 922 | completed | 1 | 2 | 16:05:37.443 |
| 925 | completed | 1 | 2 | 16:05:41.969 |
| 926 | completed | 2 | 1 | 15:58:52.705 |
| 927 | completed | 1 | 2 | 16:05:44.956 |
| 928 | completed | 1 | 2 | 16:05:46.476 |

Generation 2 zeigt eine spätere Jobgeneration, nicht automatisch eine zweite
Bildanalyse. Die Worker können gespeicherte Erkennung für Referenzänderungen
wiederverwenden. Eine nicht gespeicherte Fehlerhistorie des zweiten Versuchs
von 926 wird nicht aus dem aktuellen leeren Fehlerfeld rekonstruiert.

## Isolierte Reproduktion

`tests/photo-caption-omission-diagnosis.test.mjs` nutzt synthetische Fahrzeugdaten
und synthetische registrierte Lineups, mit den drei überprüften
Referenznummern/Team-/Fahrzeugbezeichnungen. Keine Datenbankqueries, keine
Netzwerk- oder Anbieteraufrufe; beides ist im Test ausdrücklich blockiert.

Die Reproduktion bestätigt:

- 91 mit geprüfter Nummer plus Teamhint Porsche bleibt visuell; derselbe
  Datensatz ohne dieses Teamhint matcht. Fahrzeugteilname bleibt kompatibel.
- 132 plus „bleu mercure“ wird blockiert; leerer oder exakt passender Teamhint
  erlaubt den Match.
- 7/91 allein liefern Fahrzeugtext; mit 1–2 unbekannten Beobachtungen nur
  Kontext trotz bestehender Referenzzuordnung.
- Fehlende Nummernevidenz bleibt unbekannt; inkompatible Fahrzeuge,
  widersprüchliche Referenzen und Sessiongrenzen bleiben blockiert.

Die Gegenprobe mit geleertem Hint ist **keine Freigabe**, sämtliche Hints zu
ignorieren. Die Tests belegen Bedingungen, nicht Modellgenauigkeit auf Pixeln.

Verifikation: **20 Tests bestanden, 0 fehlgeschlagen** — fünf isolierte
Diagnosetests und 15 bestehende Evidenztests mit gemocktem Anbietertransport.
Die Evidenztests wurden mit einer absichtlich unbrauchbaren lokalen
Fixture-Datenbankadresse ausgeführt; keine Workspace- oder Produktionsqueries
und kein echter Anbieterzugang waren nötig:

```sh
env -u MEDIA_STORAGE_ENVIRONMENT \
  DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:1/fixture \
  node --import tsx --test --test-concurrency=1 \
  tests/photo-caption-omission-diagnosis.test.mjs \
  tests/photo-number-evidence.test.mjs
```

## Begrenzte Empfehlungen, nur für spätere separate Freigabe

1. **Teamhinweise typisieren:** Hersteller-/Sponsorbranding nicht als exakten
   Teamkonflikt behandeln; bekannte Kurzbezeichnungen nur kontrolliert und
   eventbezogen mit tatsächlichen Referenzen vergleichen. Kein globales
   Substringmatching, kein Abschalten echter Team-/Modellkonflikte, keine
   Änderung an der vollständigen fahrzeuggebundenen Nummernevidenz.
   Zuerst 926/927 und 920/922 gegen 925/928 sowie negative Konfliktfälle testen.
2. **Captionteilzuordnung separat entscheiden:** Für Mehrfahrzeugfotos könnte
   nur das eindeutig belegte Fahrzeug genannt werden, ohne irgendeine
   Identitätsbehauptung über Begleitfahrzeuge. Das würde die aktuelle bewusste
   Alles-oder-nichts-Regel ändern und braucht eine eigene Produktfreigabe.
   Nicht automatisch das manuell bestätigte Flag setzen.
3. **Keine blinde Neuanalyse als Diagnose:** Bei 921 fehlt eine historische
   Stufenspur. Für künftig ausdrücklich ausgewählte Prüfungen wären kompakte
   Ablehnungs-/Stufenindikatoren hilfreich, ohne Bildpayloads, Zugangsdaten
   oder Personenbehauptungen. Einen konkreten Modellfehler jetzt zu behaupten
   wäre unbelegt.

Separat könnte der Betreiber später **nur** 799–801 für den Foto-Workflow und
887/931/932/933 für eine kontrollierte Wiederholung freigeben. Das wurde nicht
ausgeführt; eine Wiederholung garantiert keinen Match und kann bei denselben
Eingaben/Regeln wieder scheitern. Die bereits completed-Vergleichsfotos werden
durch Warten weder neue Nummernevidenz erhalten noch andere Matching-/Caption-
Regeln verwenden.

## Reproduzierbare lesende SQL-Prüfung

Nur auf dem berechtigten Produktions-Read-only-Zugang ausführen:

```sql
SELECT now() AS checked_at, caption_source, photo_match_status, count(*)
FROM media_items
WHERE event_id = 227 AND type = 'image' AND archived_at IS NULL
GROUP BY caption_source, photo_match_status;

SELECT now() AS checked_at, coalesce(j.status,'not_requested') AS stored_status,
  CASE WHEN j.status='completed' AND j.recognition IS NOT NULL
    AND e.reference_revision>j.reference_revision
    AND (NOT j.photo_workflow OR
      (e.photo_matching_enabled AND e.photo_matching_revision=j.photo_matching_revision))
    THEN 'queued' ELSE coalesce(j.status,'not_requested') END AS effective_status,
  count(*)
FROM media_items m JOIN events e ON e.id=m.event_id
LEFT JOIN media_analysis_jobs j ON j.media_id=m.id
WHERE m.event_id=227 AND m.type='image' AND m.archived_at IS NULL
GROUP BY 2,3;

SELECT m.id,m.caption_source,m.photo_match_status,m.identification_manual,
  m.recognition_session,m.identification,j.status,j.attempts,j.updated_at,
  j.available_at,j.error,j.duration_ms,j.reference_revision,
  j.photo_matching_revision,j.photo_workflow,j.generation,j.recognition
FROM media_items m LEFT JOIN media_analysis_jobs j ON j.media_id=m.id
WHERE m.event_id=227 AND m.id IN
  (799,800,801,887,931,932,933,926,927,922,920,894,906,925,928,921,935,929)
ORDER BY m.id;
```
