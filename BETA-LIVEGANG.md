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