# VCO Public Beta – Vorbereitung

Stand: 10. Oktober 2026. Keine Veröffentlichung oder Hostingänderung durchgeführt.

## Funktionsstand

| Stand | Funktionen |
|---|---|
| Vorhanden und weiterverwendet | Registrierung/Sessions, Galerieverwaltung, dauerhafte Medienablage, Hintergrund-Foto-KI, Fingerprint-Reuse, private Saisonreferenzen, Downloadrechte und offizielle Videoanalyse. |
| Ergänzt/geändert | Resend-E-Mail-Verifizierung, kostenlose Selbstaktivierung, Entwürfe/Veröffentlichung, Kontosperren, Admin-Ausblendung, separate Inhaltsprüfung/Quarantäne, atomare Community-Quoten, Nutzungsanzeige und faire KI-Aufnahme. Historisch freigegebene Creator ohne Rollenflag können eigene Galerien verwalten. |
| Inaktiv | Öffentliche Käufe, Upgrades, Abos, Premiumverkauf, Earnings und Auszahlungen; direkte kommerzielle APIs bleiben gesperrt. |
| Teilweise vorhanden | Zahlungs-/Premiumfelder, Guthaben, Stripe-Abhängigkeiten und historische Downloadrechte bleiben als Phase-2-Grundlagen erhalten. Galerie-/Downloadzählung besteht; daraus folgt keine vollständige Reichweiten- oder Einnahmenanalyse. |
| Nicht umgesetzt/noch offen | Betriebsfähiger Checkout, Abos und Creator-Auszahlungen; neue öffentliche Profilbild-Uploads. Resend-Einrichtung und reale Zustellbestätigung, Rechtstexte sowie separat genehmigte Veröffentlichung stehen noch aus. |

## Ablauf und Grenzen

Registrieren → E-Mail bestätigen → Creator-Zugang aktivieren → Galerie als Entwurf anlegen → Fotos hochladen → bestandene Inhaltsprüfung → veröffentlichen. Kein zusätzlicher Pflichtwizard, keine Adminfreigabe und keine Zahlung. Abgelehnte/gesperrte Konten dürfen sich nicht selbst freischalten.

Community: **500.000.000 Byte**, **5 Galerien**, **1.000 Fotos**, **5.000.000 Byte je eingehendem Foto**, keine neuen Videos. Eine eng begrenzte Adminausnahme verdoppelt Speicher/Galerien/Fotos, nicht die Community-Dateigröße oder das Videoverbot. Autorisierte Admin-/offizielle Uploads verwenden die VCO-Policy.

Speicher zählt eindeutige dauerhaft gespeicherte Original-/Low-Res-Objekte, Referenzquellen und eingebettete Profilbilddaten, einschließlich Reservierungen und noch nicht bestätigt gelöschter Dateien. Wiederverwendung zählt nicht doppelt; fehlgeschlagene Löschungen geben weder Bytes noch einen betroffenen Fotoplatz voreilig frei. Unbekannte historische Größen sperren zusätzlichen Dateiverbrauch konservativ, bis Admin-Messung/Bereinigung sie bestätigt. Messungen sind begrenzt und können wiederholt werden. Bestehender Überquotabestand wird nicht gelöscht.

## Sicherheit und Bedienung

Unabhängige Bild-/Textprüfung mit dem bestehenden bildfähigen Managed-OpenAI-Modell, einschließlich sexualisierter/anzüglicher Darstellung, Pornografie, Rassismus, Hasssymbolen und sichtbarer Schrift. Geschützte Merkmale von Menschen sind kein Sperrgrund. Automatische Erkennung ist **keine Garantie**, sämtliche verbotenen Inhalte zu erkennen.

Neue/geänderte Dateien und öffentliche Texte bleiben bei fehlendem, unklarem oder fehlerhaftem Ergebnis privat. Freigaben sind an Datei-/Textversion und Policy gebunden; Listen, Suche, Vorschauen, Cover, Originale, ZIPs und Downloads respektieren diese Regeln. Admins prüfen geeignete Zweifelsfälle privat mit Begründung; verbotene oder technisch nicht vollständig prüfbare Quellen erhalten keinen pauschalen Bypass. Animationen/Mehrbilddateien werden für neue Community-Uploads abgewiesen. Private Referenzen sind keine öffentliche Bildablage.

Historische öffentliche Medien und bereits öffentlich abrufbare Profilbilder bleiben **ungeprüfte Altinhalte**, nicht nachträglich „approved“. Keine flächendeckende Altbestandsanalyse. Neue private Accountbilder werden durch Selbstaktivierung nicht öffentlich; externe/Base64-Profilbilder lassen sich nicht über Registrierung einschleusen.

Dashboard: verständliche Quoten, Entwurfs-/Freigabe-/Prüfstatus, Veröffentlichungsaktionen und Fehlerhinweise; optionale Referenzanlage, Foto-KI ohne Extraschritt. Manuelle Tags, Captions und Identifikationen bleiben erhalten. Gemeinsame Analysequeue maximal zwei aktive Jobs, höchstens einer je Creator; manuelle Reanalyse standardmäßig zwölfmal/Stunde, Safetyprüfung separate Spur. Keine sichtbaren KI-Credits oder automatische Caption-Erstellung. VCO-Medien/Suche bleiben vorrangig; Verdienstmöglichkeiten werden nur als geplant erwähnt.

## Prüfung und Einrichtung

- Fokussierter Backendlauf: 33 Tests erfolgreich; 18 betroffene Beta-/Upload-/Quota-/Parallelitätsfälle anschließend geprüft und nach Korrektur des Uploadtests grün. Testzahlen überlappen.
- Zusätzlicher Creator-Uploadtest und bisheriger Foto-/Video-Regressionslauf erfolgreich; Befunde überlappen, Testzahlen werden nicht addiert.
- Mobile Creatorstrecke und Editorprüfung: zwei Browserprüfungen mit gemockten APIs auf frischer Vorschau erfolgreich. Öffentliche mobile Loginansicht zusätzlich visuell geprüft; die angemeldete Oberfläche wurde nicht durch die Screenshotfunktion verifiziert.
- Typprüfung und Produktionsbuild erfolgreich. Build warnt nicht blockierend über große Bundles/veraltete Browserslist-Daten.
- Nach Abschlussprüfung: 17 aktuelle Beta-/Registrierungs-/Creator-Uploadfälle erfolgreich, einschließlich gemischter Galerie-Seiten und verweigerter Adminfreigabe bei unvollständiger visueller Prüfung. Öffentliche Sichtbarkeit wird vor der Datenbank-Paginierung ausgewertet; Eigentümer und Admins behalten ihre private vollständige Ansicht.
- Mail-/Safety-Tests verwenden synthetische Dateien und gemockte Anbieter. Kein echter Bestätigungsversand. Ein neutrales Bild bestätigte zuvor die Bildanbindung; keine Beschaffung problematischer Bildsammlungen.

**Resend-Einrichtung auf ausdrücklichen Nutzerwunsch verschoben.** `RESEND_API_KEY` wurde sicher hinterlegt. `PUBLIC_SITE_URL` wurde für die Entwicklungsumgebung auf die geprüfte aktuelle Replit-Vorschauadresse gesetzt; sie ist keine Produktionsadresse. Noch benötigt: verifizierter `RESEND_FROM` und später die Produktionskonfiguration samt Zustellbestätigung. Die Verifizierungsfunktion ist implementiert und mit gemocktem Versand geprüft, aber noch nicht betriebsbereit eingerichtet. Ohne vollständige Mailkonfiguration werden keine neue Creator-Selbstaktivierung oder neue öffentliche Creator-Veröffentlichung freigegeben; bereits öffentliche ungeprüfte Altinhalte bleiben nach der beschriebenen Übergangsregel erhalten. Einmalige, gehasht gespeicherte Links laufen nach einer Stunde ab; Neuversand und Einlösung sind begrenzt, Versandfehler geben keine Verifizierung frei.

Zusätzlich ausdrücklich beauftragt: lokale Video-Fehlerdiagnose und gezielte Klassifizierung ohne neue Infrastruktur. 16 betroffene Video-/Diagnose-/Parallelitätsprüfungen sowie der erneut geprüfte Creator-Fotoupload erfolgreich; Details und weiterhin unbestätigte Live-Ursache in `docs/production-video-diagnosis.md`. Keine neuen Live-Operationen.

Unvollständige Schrift-/Symbolprüfung ist ein technischer Fehler, kein manuell freigebbarer Zweifelsfall. Die verschärfte Safety-Policy invalidiert frühere geprüfte Freigaben und Zweifelsfälle; veraltete Prüfungen können gezielt erneut angefordert werden. Das führt zu keiner flächendeckenden Altbestandsanalyse und erklärt historische ungeprüfte Legacy-Inhalte nicht zu geprüften Ergebnissen.

Vor dem öffentlichen Start: verifizierten Mailabsender und bestätigte Produktionsbasisadresse separat für Produktion konfigurieren, Mailzustellung mit Zustimmung bestätigen, Rechtstexte abschließen, additive Produktionsschemaänderungen und Veröffentlichung gesondert freigeben. Alle öffentlichen Leser müssen die neuen Schranken verwenden, bevor Beta-Schreibzugriffe aktiviert werden; gemeinsam genutzte Datenbanken dürfen nicht als isoliert vorausgesetzt werden.
