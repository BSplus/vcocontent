# Creator-Eventzuordnung: Entwicklung und kontrollierter Rollout

## Freigabe

Der Betreiber hat die Umsetzung **nur in Entwicklung** freigegeben:
„Ja, in Entwicklung umsetzen – keine Produktionsänderungen“.
Keine Veröffentlichung, Produktionsmigration, Produktionsdatenänderung oder
Produktionsneustart ist damit genehmigt. Dieses Dokument ist keine solche Freigabe.

## Additives Modell

`creator_event_associations` enthält nur `gallery_id` (Primärschlüssel) und
`official_event_id` (nicht eindeutiger Zielindex). Beide Fremdschlüssel zeigen auf
bestehende Events, mit `ON DELETE CASCADE` **nur für die Linkzeile**.
Es werden keine Event-/Galerie-IDs, URLs, Medien, Eigentümer, Publikationszustände,
Quoten, Likes oder Favoriten geändert. Keine automatische Altbestandszuordnung.
Viele Galerien desselben oder unterschiedlicher Creator dürfen dasselbe Ziel haben.

Galeriezuordnungen werden nach der Erstellung über die Creator-Verwaltung gespeichert,
geändert oder entfernt. Auch Administratoren dürfen mit diesem Endpunkt nur ihre eigenen
Creator-Galerien zuordnen, nicht offizielle Events oder fremde Galerien.

## Sichtbarkeit

Ziele müssen offizielle Events (`creator_id IS NULL`), veröffentlicht, nicht
ausgeblendet, nicht Premium und legacy-safe oder nach aktueller Safetyregel
versionsgleich freigegeben sein. Private, Draft-, gesperrte oder ungeprüfte Ziele
sind weder auswählbar noch als Ziel-ID/Metadaten über eigene Zuordnungen sichtbar.
Eine bereits gespeicherte Zuordnung bleibt bei vorübergehender Ausblendung bestehen;
die Verwaltung zeigt nur „Linked event unavailable“ und erlaubt Wechsel/Entfernung.

Die öffentliche Liste nutzt zusätzlich die bestehende unabhängige Galerieprüfung:
Veröffentlichung, Safety-/Versions-/Verifikationsregeln, Creator-Sperre/Ablehnung,
Adminausblendung und kein Premium. Auch Manager sehen hier nur öffentliche Galerien.
Die Liste enthält ausschließlich ID, Titel, Datum und Creatorattribution; keine
Coverbilder aus ungeprüften Quellen, privaten Medien, Safetydetails oder Profildaten.
Öffentliche Medien werden unverändert über die konkreten Galerie-/Fotoendpunkte
geprüft. Offizielle Medien einschließlich Pagination stehen vor Community-Galerien.

## Entwicklung anwenden

Migration: `migrations/creator-event-association.sql` (transaktional, idempotent).
Angewendet auf die Entwicklungsdatenbank; im bestehenden Post-Merge-Entwicklungsablauf
`scripts/apply-dev-process-schema.mjs` enthalten. Kein Startup- oder Build-DDL.
Vor jeder weiteren Anwendung die tatsächliche Datenbankzuordnung prüfen; nicht
annehmen, dass beliebige externe Verbindungen getrennte Umgebungen darstellen.

Nach Integration in Entwicklung:

```sh
node --import tsx scripts/apply-dev-process-schema.mjs
npm run check
npm run build
node --import tsx --test --test-concurrency=1 tests/creator-event-association.test.mjs
node --test tests/creator-event-association-ui.test.mjs
```

Browserprüfungen benötigen die laufende Entwicklungsanwendung; API-Fixtures sind
synthetisch, nicht mit Produktionskonten angemeldet. Backendprüfungen erzeugen
isolierte Entwicklungsfixtures und räumen sie wieder auf.

### Durchgeführte Prüfung

- 7 neue Backendprüfungen erfolgreich: Erstellen/Ändern/Entfernen von Links,
  mehrere Creator und mehrere eigene Galerien pro Ziel, Fremdeigentum auch für
  Administratoren, ungültige Eingaben, Safety-/Versions-/Verifikationsregeln,
  verborgene/private/Premium-Ziele, gesperrte Creator, Quoten, unveränderte
  Galerie-/Foto-IDs und Likes/Favoriten sowie Ziel-Löschung.
- 2 neue Browserprüfungen erfolgreich: Neuanlage mit anschließender Zuordnung,
  Wechsel/Entfernung, abgewiesene und nicht mehr verfügbare Ziele, 390px-Bedienung;
  offizielle Medien vor mehreren zugeordneten Creator-Galerien, Attribution,
  ursprüngliche Galerielinks, Fehler mit Retry, Leerzustand und kein Communityabruf
  auf Creator-Galerieseiten.
- 12 bestehende Backend-/Schema-Regressionsprüfungen sowie bestehende
  Community- und Beta-Browserprüfung erfolgreich. Der ältere Beta-Browsertest wurde
  an die bereits vorhandene Studio-Navigation über „My Galleries“ angepasst,
  ohne die Anwendung zu ändern.
- TypeScriptcheck, Produktionsbuild und Whitespacecheck erfolgreich.
  Nur vorhandene Buildwarnungen zur Bundlegröße und Browserslist-Datenalter.
- Entwicklungsworkflow erfolgreich gestartet; tatsächliche öffentliche Eventseite
  zusätzlich per Screenshot geprüft. Angemeldete Bedienung wurde mit synthetischen
  API-Fixtures geprüft, nicht mit echten Produktionskonten.

## Spätere Produktion – ausschließlich nach separater Zustimmung

1. Datenbankziel und Verantwortlichkeit feststellen; externe Datenbanken werden
   nicht automatisch durch Replits Publish-Schemavergleich migriert.
2. Betreiberfreigabe für Datenbankänderung und Veröffentlichung separat einholen,
   Schema-/Datenbackup und Rollbackfenster bereitstellen.
3. Bei externer Produktion die geprüfte additive SQL-Datei erst nach Freigabe
   kontrolliert durch den zuständigen Betreiber anwenden; bei Replit-verwalteter
   Produktion den freigegebenen Publish-Schemavergleich nutzen.
4. Erst danach freigegebenen Anwendungscode veröffentlichen. Der bestehende
   read-only Startup-Check verlangt die neue Tabelle/Spalten und schreibt keine DDL.
5. Freigegebene Liveprüfungen auf Auswahl, unabhängige Galerieveröffentlichung,
   Community-Reihenfolge und Datenschutz durchführen. Keine automatische Zuordnung.

## Rücknahme

Code zuerst auf die Version ohne Zuordnungszugriffe zurücksetzen und deren Start
prüfen. Linkdaten vor Löschung exportieren/sichern, wenn sie wieder benötigt werden.
`migrations/creator-event-association-down.sql` entfernt anschließend transaktional
**nur die Zuordnungstabelle**, inklusive ihres Indexes. Bestehende Galerien, Medien,
Likes und Favoriten bleiben bestehen. Rollback ist nicht verlustfrei für Links:
erneute Anwendung der Up-Migration erzeugt eine leere Tabelle; für Wiederherstellung
ein freigegebenes Linkbackup mit weiterhin existierenden Event-IDs verwenden.
Die Down-Datei niemals bei laufendem zuordnungsabhängigem Code anwenden.
