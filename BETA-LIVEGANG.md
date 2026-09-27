# VCO: Checkliste für die öffentliche Beta

Diese Vorbereitung veröffentlicht die App **nicht**. Bestehende Testdaten werden weder
automatisch migriert noch gelöscht. Die Beta bietet keine Käufe, Premium-Downloads
oder Creator-Auszahlungen; die betreffenden Server-Endpunkte sind gesperrt.

## Vor der Freigabe

1. Im Replit-Projekt unter **Tools → App Storage** einen Bucket für dieses Projekt
   erstellen bzw. zuordnen. Der private Bucket muss sowohl in der Entwicklung als
   auch in der veröffentlichten App verfügbar sein. Neue Uploads werden dort
   gespeichert; `/tmp` dient nur als temporärer Upload-Puffer.
2. Für die veröffentlichte App eine PostgreSQL-Datenbank mit dem bisherigen
   `DATABASE_URL`-Schema bereitstellen und `SESSION_SECRET` für Produktion setzen.
   Die bestehende Tabelle `session` wird verwendet und bei einer neuen Datenbank
   bei Bedarf angelegt. Produktionsdatenbank und App-Storage-Zuordnung vor dem
   Freigeben im Publishing-Dialog prüfen. Testdaten müssen nicht übernommen werden.
3. `npm run check`, `npm run build` und bei laufender Vorschau `npm test` ausführen.
   Die Publishing-Konfiguration baut die App und startet `npm run start` mit
   `NODE_ENV=production`; nicht den Entwicklungsserver veröffentlichen.
4. In der Vorschau und nach der Veröffentlichung testen: Registrierung, Login,
   Logout, Login nach Serverneustart, Creator-Freigabe, Event anlegen/bearbeiten,
   Foto- und Videoupload, Vorschaubild, Abruf nach Neustart und Download.
   Als Fremdnutzer Lösch-/Änderungs-/Analyseanfragen und den Abruf privater
   Originale prüfen. Videos erfordern zum Abspielen aktuell eine Anmeldung;
   ohne Video-Transcoding ist nur ein generisches Poster öffentlich sichtbar.
   Vor dem öffentlichen Start mindestens ein aktuelles Event mit echten Inhalten
   anlegen; die vorhandenen älteren Testevents füllen die Startseite nicht.
5. Ohne `OPENAI_API_KEY` bleibt die KI-Verschlagwortung optional und liefert eine
   sichtbare Nichtverfügbarkeitsmeldung. Mit konfiguriertem Schlüssel eine
   **Bild**-Analyse gegen das tatsächlich verfügbare Modell testen. Für Videos
   gibt es derzeit keine verlässliche Frame-Extraktion, daher keine KI-Analyse.
6. Bezahlseiten und Endpunkte vor Freigabe als nicht verfügbar kontrollieren.
   Bezahlfunktionen nur in einem separaten Vorhaben mit Testzahlungen,
   Webhook-Signaturprüfung, idempotenter Gutschrift und geschützten Downloads
   aktivieren. Erst nach allen Prüfungen eigenständig veröffentlichen.

## Bekannte Grenzen

- Alte, bereits als Base64 gespeicherte Testmedien bleiben unverändert. Neue
  Uploads benutzen private App-Storage-Objekte; ohne zugeordneten Bucket schlägt
  der Upload ausdrücklich fehl und die öffentliche Beta ist nicht freigabefähig.
- Der private Video-Stream unterstützt derzeit kein HTTP-Range-Seeking; das
  Abspielen kann bei großen Videos langsam sein. Für bessere öffentliche
  Video-Vorschauen ist eine gesonderte Transcoding-Pipeline erforderlich.


## Medienbudget und Kostenplanung (Stand September 2026)

Neue Uploads: Bild bis 5 MiB und 40 Megapixel, Video bis 50 MiB. Bilder werden
serverseitig auf eine WebP-Darstellung mit höchstens 2560 px langer Kante
(hartes Limit 4 MiB, Ziel 2–4 MiB) und eine WebP-Vorschau mit höchstens 640 px
(unter 100 KiB) reduziert. Das eingereichte Bild wird **nicht** als drittes
Objekt gespeichert. Bei Bildern mit Transparenz und animierten GIFs kann die
Darstellung anders aussehen; vor einem Verkauf unveränderter Originaldateien
muss ausdrücklich entschieden werden, ob und wie Originale separat gespeichert
werden. Solange Bezahlmedien gesperrt sind, akzeptiert der neue Uploadpfad keine
Premium-Events. Videos bleiben ohne Transcoding und haben ein kleines generisches
WebP-Poster. ZIP wird nur im Browser entpackt: maximal 100 Bilder, 100 MiB
entpackt, 5 MiB pro Bild; das Server-Uploadlimit gilt danach für **jede** Datei.

Die Standardbudgets betragen 2 GiB/1000 Medien pro Event sowie 10 GiB/5000
Medien pro Creator; 80 % markieren eine Warnschwelle. Über die positiven
Integer-Umgebungsvariablen `MEDIA_IMAGE_MIB`, `MEDIA_VIDEO_MIB`,
`MEDIA_EVENT_MIB`, `MEDIA_CREATOR_MIB`, `MEDIA_EVENT_COUNT` und
`MEDIA_CREATOR_COUNT`, `MEDIA_IMAGE_MEGAPIXELS`, `MEDIA_DISPLAY_EDGE` und
`MEDIA_THUMB_EDGE` lassen sich die Grenzen beim Start ändern. Der
Upload-Dialog bezieht die Eingangsgrenzen direkt vom Server.
Reservierungen werden vor dem Objektschreiben in PostgreSQL
unter Event-/Creator-Sperre geprüft. Gelöschte oder fehlgeschlagene Uploads
werden zur nachholbaren Objektbereinigung erfasst. Eine 15-Minuten-Prüfung
holt offene Bereinigungen nach; abgebrochene Reservierungen laufen nach einer
Stunde ab. Unter **Admin → Media Management → Storage usage** stehen Verbrauch,
ältere unbekannte Größen und ausstehende Bereinigungen sowie ein manueller
Wiederholungs-Knopf. Bei anhaltenden Fehlern nicht blind Objekte löschen:
`media_cleanup.last_error` prüfen, Speicherzugriff reparieren und erneut ausführen.
Die Tabellen `media_reservations` und `media_cleanup` sind keine
Medienbestände. Vor Veröffentlichung die additive Migration
`migrations/0001-media-budget.sql` und danach `migrations/0002-nextcloud-import.sql` auf die Produktionsdatenbank anwenden;
keine vorhandenen Medien migrieren oder löschen.

### Nextcloud-Bildimport für Admins

Nach der Migration `0002-nextcloud-import.sql` die Umgebungsvariable
`NEXTCLOUD_BASE_URL` auf die HTTPS-Basisadresse **einer** vertrauenswürdigen
Nextcloud-Instanz setzen (z. B. `https://cloud.example.org`, bei Installation
im Unterpfad `https://cloud.example.org/nextcloud`). Nur Links dieser Instanz
werden angenommen. Für interne Ordnerlinks zusätzlich `NEXTCLOUD_USERNAME`
und das separate **App-Passwort** `NEXTCLOUD_APP_PASSWORD` als serverseitige
Secrets einrichten. Das Konto braucht Lesezugriff auf die Ordner; reguläre
Kontopasswörter nicht verwenden. Öffentliche Links `/s/TOKEN` brauchen keine
Konto-Konfiguration; ein Freigabepasswort kann der Admin pro Link im Dialog
eingeben. Die Zugangsdaten werden nicht in Importtabellen gespeichert. Nach
einem Serverneustart oder Abbruch trägt der Admin dieselben Links (und
gegebenenfalls Freigabepasswörter) erneut im Event-Dialog ein und startet
den Import dort erneut. Bereits gespeicherte Dateien werden nicht verdoppelt.
Interne Links werden als `/apps/files/files/ID?dir=/Ordner` oder als
`/remote.php/dav/files/BENUTZER/Ordner` unterstützt; andere Ansichtslinks
werden bewusst abgewiesen. Es gibt keine laufende Synchronisierung. Ein
Import läuft mit maximal 10 Links, 300 Unterordnern, 500 Bildern,
500 MiB übertragenen Bilddaten, 5 MiB je Bild, 60 Sekunden Vorschau und
10 Minuten Verarbeitung; die normalen Album-Speicherbudgets gelten zusätzlich.

Bestandsmessung der Entwicklungsdatenbank bei Einführung: 72 Medienzeilen,
davon 15 Base64-URLs; URL- und Vorschaubildtexte historischer Einträge belegten
zusammen ca. 128 Mio. Zeichen. Alte Objektgrößen sind nicht zuverlässig
rekonstruierbar. Base64-Text wird bei der Budgetprüfung ungefähr mit 3/4 der
Zeichenlänge berücksichtigt; externe Altdateien ohne Größenangabe bleiben
unbekannt. Eine separate, freizugebende Bestandsmigration wäre nötig, um sie
exakt zu erfassen. Keine automatische Löschung der Testmedien.
Listen schicken Base64-Altdateien nicht mehr inline: ein einzelner geschützter
Dateiabruf liefert sie bei Bedarf, historische Bildvorschauen werden dabei
on demand auf die Vorschaugröße verkleinert. Das ist keine Bestandsmigration.

Kostenbeispiel **vor** etwaigen Kontogutschriften: Replit App Storage nennt
seit August 2026 **$0.015/GiB-Monat**, **$0.05/GiB Datenübertragung**,
**$0.0004/1000 Basic Operations** und **$0.005/1000 Advanced Operations**
([Preisanpassung](https://docs.replit.com/billing/aug-cloud-billing-updates),
[App-Storage-Abrechnung](https://docs.replit.com/billing/object-storage-billing)).
10.000 Fotos zu je 3 MiB Darstellung + 0,1 MiB Vorschau ≈ 30,3 GiB
Speicher, also ~$0.45/Monat. 100.000 Vorschaubild-Abrufe à 0,1 MiB
≈ 9,5 GiB Übertragung bzw. ~$0.48; 1000 Downloads à 3 MiB ≈ 2,9 GiB
oder ~$0.15. 101.000 einfache Abrufoperationen wären rechnerisch
~$0.04, sofern sie als Basic Operations eingestuft werden; Uploads und
sonstige Operationen kommen hinzu. Die Datenbank ist hier **Neon** via
`DATABASE_URL`, nicht automatisch Replit-DB: Neon-Tarif, Compute, Speicher,
Backups und Freikontingent müssen im tatsächlichen Konto geprüft werden;
keine unbestätigten Neon-Preise in die Summe einrechnen. Zum Vergleich,
**nur falls** auf Replit Database umgestellt würde, dokumentiert Replit
$0.35/GiB-Monat und $0.16/Compute-Stunde
([Quelle](https://docs.replit.com/billing/aug-cloud-billing-updates));
das ist **nicht** der aktuelle Datenbankpreis dieses Projekts.
Monatlich Objektspeicher, Übertragung, Operationen und Neon-Rechnung mit der
Admin-Ansicht abgleichen; ab 80 % des konfigurierten Budgets Kapazität prüfen.
