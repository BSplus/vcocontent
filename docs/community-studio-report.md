# Community und Creator Studio – Abschluss und Bestandsmatrix

Stand: 10 October 2026. Entwicklungsumgebung, keine Veröffentlichung oder Produktionsänderung.

## Bestand und Umsetzung

| Bereich | Bestand vor Erweiterung | Ergebnis |
|---|---|---|
| Lokale Konten, Anmeldung, Creatorrollen | Vollständig vorhanden | Wiederverwendet, kein zweites Kontosystem. |
| Verifizierung, offene Aktivierung, Sperren, Quoten, Safety/Publikation | Integrierte Beta vollständig vorhanden; Mailbetrieb benötigt weiterhin Betreiberkonfiguration | Bestehende Regeln wiederverwendet, nicht neu implementiert. |
| Offizielle Events, Medien, öffentliche Galerien/Creatorprofile, Sharing | Vollständig vorhanden | Offizielle Inhalte weiter vorn; öffentliche Ansicht ohne Konto, geschützte Originale weiterhin mit Konto. Sharing in Details/Profilen aus bestehendem Baustein ergänzt. |
| Likes und Favoriten | Fehlend | Vollständig ergänzt für Fotos und die bestehende Event-/Galerieeinheit; idempotente persönliche Verweise, eindeutige Datenbankindizes, optimistische Aktionen mit Rücknahme und Anmelderückkehr. Keine Mediendateien kopiert. |
| Downloads | Streams und Aggregatzähler vollständig; persönliche Historie fehlend | Private, paginierte Historie erst nach erfolgreicher autorisierter Serverlieferung. Vorschauladen, Originalansicht, Freigabe-POST, Fehler und Abbruch erzeugen keine Historie. |
| Creator Studio | Teilweise: vorhandene Verwaltung/Statistiken | Studio, My Galleries, Account; Coverkarten, jüngste Fotos, tatsächliche Nutzung, Profilpfad, bestehende Upload-/Bearbeitungs-/Analyse-/Publikationsaktionen erhalten. Mobil und Tastatur geprüft. |
| Galerieerstellung/Uploads | Vollständig vorhandene Editoren und Beta-Regeln | Wiederverwendet; Drag-and-drop funktioniert, neue Fotos werden automatisch verarbeitet. Optionales Editieren, keine Caption-Einzelbestätigung; Safetyfreigabe bleibt unabhängig. |
| Profilbearbeitung | Öffentliches Profil und moderierte Anmeldung/Aktivierung vorhanden, Self-Service-Editor fehlend | Neuer kleiner Editor nutzt dieselbe unabhängige Safetyprüfung. Nur eigener Username/Bio/normalisiertes Bild, keine Rechte/E-Mail/Zahlungsfelder. Username ist auch Loginname, UI weist darauf hin. |
| Fotocaptions | Vorschläge zur manuellen Anwendung vorhanden | Automatik nur für neue Community-Fotos ohne eigenen Text; offizieller Vorschlagspfad, Videoanalyse und historische Texte unverändert. |
| Credits/Premium/Stripe-Felder und Bibliotheken | Vorhanden, kommerzielle Endpunkte inaktiv | Erhalten und inaktiv. Keine Käufe, Upgrades, Abos, Connect-Onboarding oder Auszahlungen aktiviert. |
| Transaktionsledger, Connect, Auszahlungen | Funktionierende Grundlage nicht nachgewiesen/fehlend | Nicht neu gebaut; vorhandene Zahlungsfelder sind kein Nachweis funktionierender Zahlungsinfrastruktur. |
| Follow/Kommentare/Feed | Fehlend | Nicht umgesetzt, ausdrücklich außerhalb des Umfangs. |

## Grenzen des Galerie-/Eventmodells

Eine Galerie ist weiterhin das bestehende Event. Like-/Favoritenaktionen auf „Galerie“ und
„Event“ zählen dieselbe Einheit, nicht doppelt. Creator besitzen eigene Eventgalerien;
mehrere unabhängig veröffentlichte Creatorgalerien *unter einem offiziellen Event* sind
mit diesem Modell nicht abbildbar. Dafür wurde kein zweites Modell eingeführt. Eine
spätere Erweiterung benötigt zuerst eine Betreiberentscheidung.

## Zugriff und Datensicherheit

- Alle Listen werden vor Pagination an aktuelle öffentliche Event-/Mediensichtbarkeit,
  Sperren, Safetyversion und Premiumschutz gebunden. Gespeicherte Verweise verleihen
  keine weiteren Rechte. Galeriepreview wird aus aktuell zulässigem Foto abgeleitet,
  nicht aus einer alten gespeicherten Vorschau.
- Öffentliche Anzahl und persönlicher Zustand sind getrennte Felder; keine öffentlichen
  Nutzerlisten. Backend-API-Antworten sind `no-store`, Frontendkeys nach Sitzung getrennt.
  Persönliche Listen werden nicht als langlebiger Navigationcache behalten.
- IDs stammen bei Mutationen aus der Session. Eindeutigkeit verhindert doppelte Likes
  und Favoriten bei parallelen Anfragen. Konten-/Medien-/Eventlöschung entfernt
  Verknüpfungen per Fremdschlüssel; keine historische Medienumschreibung.
- Profiländerungen werden vor Speicherung geprüft. Neue Bilder nur JPEG/PNG/WebP,
  maximal 1 MB Quelle, serverseitig normalisiert; Animationen/externe URLs abgewiesen.
  Creator-Bildkosten berücksichtigen bestehende Speicherquoten. Keine Eigeneskalation.

## Downloadsemantik

Authentifizierte Freigaben erhalten ein serverseitiges, kurzlebiges Operationstoken,
gebunden an Nutzer, Medium und Qualität. Wiederholte Lieferungen derselben Operation
erzeugen höchstens einen Eintrag und eine Zählererhöhung. Neue bewusste Freigaben und
spätere direkte Download-GETs bleiben möglich. Tokens sind keine Historie und laufen
nach einer Stunde ab; das ist **keine** behauptete Historien-Aufbewahrungsfrist.

Gezählt wird nur das erfolgreiche Ende der serverseitigen Streamübertragung, nicht
Speichern auf dem Endgerät. Für direkte GETs ohne Operationstoken ist keine zuverlässige
Unterscheidung von Browserwiederholung und absichtlichem neuem Download möglich.
Aufzeichnungsfehler werden sicher protokolliert, ohne die Datei erneut auszuliefern.
Historie und Zähler werden für authentifizierte Operationen gemeinsam geschrieben;
schlägt diese Transaktion fehl, kann trotz erfolgreicher Lieferung ein Eintrag fehlen.
Anonyme zulässige offizielle Low-Res-Downloads behalten nur den bestehenden Zähler.

## Captionstatus und Moderation

Neue leere Community-Fotos werden beim Anlegen als automatisch bearbeitbar markiert.
Erfolgreiche Verarbeitung darf einmalig eine kurze Caption aus vorhandenem bestätigtem
Galerietitel, Circuit-/Serien-/Rundenkontext und Datum erzeugen. Sie kostet keinen
zusätzlichen Caption-Provideraufruf. Tag-only-Ergebnisse werden absichtlich nicht
zu Bildidentitäten umgedeutet; registrierte Fahrerlisten beweisen keine abgebildete Person.

Manuelle Captions (auch ausdrücklich leer), IPTC-/Importtexte und historische Texte
werden bewahrt. Herkunft und atomare Zeilensperre schützen gegen konkurrierendes Editieren.
Automatisch geänderter öffentlicher Text erhöht die Inhaltsversion und durchläuft die
vorhandene unabhängige Safetyprüfung; bis dahin bleibt neues Material privat.
Die Caption selbst verlangt keine manuelle Bestätigung. Datumsbestandteile nutzen
Tag, ausgeschriebenen englischen Monat und vierstellige Jahreszahl.

## Rechtliche Nachprüfung, keine neue Rechtstextfassung

Die integrierten Rechtehinweise bleiben erhalten. Neue Verarbeitung ist im
`docs/legal-processing-register.md` ergänzend dokumentiert. Betreiber/juristische
Nachprüfung müssen insbesondere persönliche Verknüpfungen, Downloadhistorie,
Profil-/KI-Verarbeitung, tatsächliche Empfänger, Lösch-/Auskunftsfunktion und
Aufbewahrung/Backups bewerten. Es gibt keine neuen Frist-, Lizenz-, Einnahmen- oder
Rechtskonformitätszusagen. Der Earningshinweis nennt ausschließlich inaktive Funktionen.

## Schema und Betrieb

Additive Migration: `migrations/community-studio.sql`. Ausschließlich lokal über den
bestehenden Dev-Schemaablauf angewendet; Deployment führt keine ungefragte DDL aus.
Vor einer später ausdrücklich genehmigten Veröffentlichung muss dieselbe additive
Migration kontrolliert in die Produktionsdatenbank übernommen werden.

## Prüfung

- `npm run check` und `npm run build`: erfolgreich.
- 40 erfolgreiche fokussierte Backendchecks: Community, Media-Prozesse, Public Beta, Creator-Upload,
  Download-Access, Caption-Vorschläge und Datumsformat. Provider ausschließlich gemockt;
  exklusiver Queuebetrieb, keine bezahlten Tests oder Produktionsuploads.
- Zwei erfolgreiche Browserchecks mit synthetischen API-Fixtures: Likes/Speichern,
  Fehler-Rollback, Favoriten-Originallink, wiederholte Downloadzeilen, Settings-PATCH,
  Studio/Coverkarten/Account, Gast-Anmelderückkehr, Tastatur und 390px/1280px.
- Öffentliche echte Startseite zusätzlich per Screenshot geprüft. Angemeldete
  Browserflächen wurden mit Fixture-Session geprüft, nicht mit Produktionskonten.
- Buildhinweise: große vorhandene Haupt-JS-Datei und ältere Browserslist-Daten;
  kein Buildfehler. Keine Veröffentlichung/Hostingänderung/Produktionsneustarts.
