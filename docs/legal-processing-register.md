# VCO Media Database – Quellen- und Verarbeitungsverzeichnis

Stand: 10. Oktober 2026. Codeabgleich **nach Integration der Creator-Beta**.
Keine Produktionsinspektion, kein Hostingwechsel, keine Vertragsprüfung und keine
Secrets ausgelesen. „Implementiert“ bedeutet nicht „live konfiguriert“.

## Quellen und Vergleich

| Quelle | Prüfung / Ergebnis |
|---|---|
| https://vco-esports.com/imprint | Erneut abgerufen am 10. Oktober 2026. Inhaltlich identisch mit `.local/tasks/vco-legal-source-snapshot.md`: DDG, Anschrift, beide Geschäftsführer, HRB 255920, DE331164657, § 18 (2) MStV, Streitbeilegung. |
| https://vco-esports.com/privacy-policy | Erneut abgerufen am 10. Oktober 2026; inhaltlich identisch mit der Referenz, Quellenfassung 2 October 2026. Betreiber, Datenschutzkontakt, Rechte und BayLDA übernommen; anwendungsfremde Auth-/Social-/Videoabschnitte nicht übertragen. |
| https://www.gesetze-im-internet.de/ddg/__5.html | Aktuelle Informationspflichten abgerufen; § 5 DDG statt TMG. |
| https://www.gesetze-im-internet.de/ttdsg/__25.html | Aktuelle Vorschrift heißt TDDDG; Abs. 2 nur für notwendige Übertragung/ausdrücklich gewünschte Dienste, Abs. 1 sonst Einwilligung. |
| https://eur-lex.europa.eu/eli/reg/2016/679/oj | DSGVO als Primärquelle: insbesondere Art. 6, 9, 13/14, 15–22, 28, 35 und 44–49. |
| https://www.bundesnetzagentur.de/DE/Fachthemen/DSC/1_Themen/PflichtenVermittlunggsdienste/artikel.html | Abgerufen: abgestufte DSA-Pflichten; Art. 11/12/14, Hostingpflichten Art. 16–18 und weitere Plattformpflichten separat. Größenbefreiungen sind keine allgemeine Befreiung. |
| Replit-Dokumentation: AI Integrations, App Storage, Database, Project geography; https://replit.com/privacy-policy und https://replit.com/dpa | Dokumentationssuche bestätigt managed AI und Storage-/Hostingkonzepte. Daraus **keine** konkrete Region, Enterprise-ZDR-Regel oder Vertragsgarantie dieses Projekts abgeleitet. |
| https://resend.com/legal/privacy-policy | Transparenzlink zum vorgesehenen Versanddienst; tatsächliche Vertragsbedingungen, Region und Provideraufbewahrung ungeprüft. |

## Tatsächliche Verarbeitung

### Ergänzung Community & Creator Studio

Neue Community-Verarbeitungen (10 October 2026), zur Betreiber-/Rechtsnachprüfung,
ohne parallele Neufassung veröffentlichter Rechtstexte:

| Prozess | Daten und Zugriff | Zweck / Prüfbedarf |
|---|---|---|
| Likes | Konto-ID, Foto-/Event-ID, Erstellzeit. Öffentlich nur Anzahl, persönlich eigener Zustand. | Gewünschte Communityfunktion; Rechtsgrundlage, Auskunft und Löschablauf bestätigen. Keine Rangliste/Like-Nutzerliste. |
| Favoriten | Private Konto-/Inhaltsverknüpfungen und Zeit, keine kopierten Dateien. Nur eigene Session, aktuelle Inhaltsfreigabe zusätzlich erforderlich. | Gewünschtes persönliches Archiv; Aufbewahrung, Kontolöschung/Backups und Auskunft prüfen. |
| Downloadhistorie | Konto, Medium, Qualität, Operation, Zeitpunkt erfolgreicher Serverlieferung. Nur eigene Session; verborgene Inhalte werden nicht angezeigt. | Gewünschte persönliche Historie, keine Behauptung lokalen Speicherns. Fristen und Auskunft/Löschung offen; keine Tracking-/Werbezwecke daraus ableiten. |
| Kurzlebige Downloadoperation | Zufällige ID mit Nutzer-/Medien-/Qualitätsbindung; Gültigkeit eine Stunde. | Idempotente Lieferung, nicht Historienretention. Operationsbereinigung separat von Historienlöschung. |
| Profiländerungen | Eigenes Username/Bio/Bild, normalisierte Bilddaten, bestehende unabhängige Safetyverarbeitung. | Öffentlicher Creatorauftritt; gleiche Moderationsempfänger wie Beta. Keine eigenen Rollen-/E-Mail-/Zahlungsänderungen. |
| Automatische Communitycaption | Bestätigter Galerie-/Circuit-/Datums-/Serienkontext, bestehender Verarbeitungsabschluss, Text-Safetyprüfung. | Konservative Beschreibung ohne neue Identitätsannahmen oder zusätzliche Caption-KI-Abfrage. Empfänger, Safetycache und bestehende KI-Dokumentation rechtlich nachprüfen. |

Löschung von Nutzer/Medium/Event entfernt Verknüpfungen technisch per Fremdschlüssel.
Das ersetzt weder eine freigegebene Kontolöschoberfläche noch einen Betreiberprozess
für Auskunft, Backups oder gesetzliche Aufbewahrung. Konkrete Fristen wurden nicht
festgelegt. Details und Schema-/Betriebsgrenzen: `docs/community-studio-report.md`.

| Prozess / Codebeleg | Daten, Zugang und Empfänger | Zweck / vorgeschlagene Grundlage | Aufbewahrung / Betriebsbestätigung |
|---|---|---|---|
| HTTP, `server/index.ts`, `server/vite.ts` | IP, Request-/Browserdaten, Referrer/Status; Server und Hosting. Diagnosen können Fehlerdaten enthalten. | Auslieferung/Sicherheit, Art. 6 (1) (f). | Logfelder, Zugriffsrechte, Infrastrukturfristen und Backupfristen live offen. |
| Login, `server/auth.ts`, `server/storage.ts`, `server/index.ts` | Lokales Passport, gesalzener scrypt-Hash; Konto-/Rollen-/Sperrstatus und PostgreSQL-Session. Keine externe Identity-Anmeldung. | Angeforderte Kontofunktion (b), Schutz (f). | `vco.sid`: 24 h rollierend, HttpOnly, SameSite=Lax, Secure bei production; Logout zerstört Session. DB-/Backupbereinigung getrennt bestätigen. |
| Registrierung / Verifizierung, `server/email-verification.ts`, `server/beta-config.ts` | E-Mail, Bestätigungslink an Resend; Tokenhash, Ablauf, Versand-/Verbrauchszeit in DB. Username/Bio an Safety-KI. | Kontoverifizierung (b), Missbrauchsschutz (f). | Link 1 h/einmalig; erneuter Versand ersetzt Datensatz, fehlgeschlagene Zustellung entfernt den betreffenden Hash. Keine allgemeine Expiry-Löschung. Reale Zustellung/Absender/öffentliche Origin separat bestätigen. |
| Profil, `server/routes.ts` `/api/users/:id`, `shared/schema.ts` | Öffentlich: ID, Username, Bio, Creatorflag/-status, nur bereits öffentliche Profilbilder. Nicht öffentlich: E-Mail, Hash, interne Kontoinformationen. | Profil-/Creatorservice (b), Galeriepräsentation (f). | Neue externe Bilder bei Registrierung gesperrt. Historische Bild-URLs können Browseranfragen an fremde Hosts auslösen. |
| Upload / Veröffentlichung, `server/routes.ts`, `server/beta-access.ts`, `server/media-storage.ts` | Private App-Storage-Objekte, DB-Metadaten; Eigentümer und Admins sehen Entwürfe. Öffentliche Titel, Caption, Credits, Tags/Identifikationen, Cover/Preview; größere Dateien/Communitydownloads/Video mit Login je Zugriffspfad. | Angeforderter Creatorservice (b); Publikation identifizierbarer Dritter nur mit eigener geprüfter Grundlage, regelmäßig Interessenabwägung (f) oder gesonderte Einwilligung. | Bildoriginal wird in aktuellem Uploadpfad nicht zusätzlich als drittes Objekt erhalten; historische DB-Dateien bleiben. Unpublishing ≠ Erasure. Cleanup ist nachholbar, nicht garantiert sofort. |
| Private Referenzen, `server/reference-routes.ts`, `server/reference-storage.ts`, `server/entry-list.ts`, `server/reference-matching.ts` | Datei, Zeilen, Namen/Teams/Nummern; Eigentümer/Admin. Saisonreuse nur gleicher Owner/Serie/Jahr. CSV/XLSX/readable PDF lokal; Bild/scanned PDF an managed OpenAI. Abgeleitete Lineups können öffentlich werden. | Creatorservice (b), korrekte Organisation (f); Art. 14 für indirekt erhaltene Daten beachten. | Referenzquellen in App Storage; keine eigenständige automatische Frist. Rechte/Quelle und Rechtsgrundlage für Listen klären. |
| Nextcloud, `server/nextcloud.ts`, `server/import-manifest.ts` | Admin-only; öffentliche Instanzen nextcloud.vco-motorsports.com und nextcloud.bs-plus.de oder konfigurierte eigene Instanz. Serverabruf/Sharezugang, Dateinamen, Importprotokolle; importierte Kopien in eigener Ablage. Kein Browser-iframe. | Autorisierte Archivübernahme (f), ggf. vereinbarter Service (b). | Manifest verschlüsselt, für 24 h Jobs nutzbar; nach erfolgreichem Abschluss entfernt, bei Fehlern nicht automatisch gleich gelöscht. Quellinstanz/-betreiber, Auftrag/Rolle/Region sind unbestätigt. |
| Foto-/Video-KI, `server/image-analysis.ts`, `server/video-recognition.ts`, `server/analysis-jobs.ts`, `server/utils/ai-tagger.ts` | Managed-OpenAI-Routing über Replit; Bilder, ausgewählte Frames, Kontext/Referenzinformationen. Kein kompletter Video-/Audiostream. DB: Tags, Evidence, Identifikationen, Jobstatus. | Suchbare Medien (f), angeforderte Referenz-/Creatorfunktionen (b). | Job-/Evidence-/Fingerprintfristen offen. Modellparameter sind keine Aussage über Anbieterregion, Training, Retention oder Vertragsrolle. |
| Safety, `server/content-safety.ts`, `server/beta-routes.ts`, `server/beta-policy.ts` | Separate KI-Prüfung von Bild und Text/Symbolen, Status/Reason/Version/Policy, Fingerprintcache; Adminentscheidungen mit Begründung. Quarantäne/Blockade und textbasierte Registrierungs-/Aktivierungsablehnung möglich. | Schutz von Menschen/Dienst (f), konkrete gesetzliche Pflichten (c). | Cache-Reuse 7 Tage, **keine** 7-Tage-Löschfrist. Geeignete Zweifelsfälle manuell prüfbar; verbotene/unvollständige Ergebnisse nicht pauschal freischaltbar. Art. 22/35 und effektive menschliche Neubewertung offen. |
| Mengen/Zähler/Rate Limits, `server/beta-policy.ts`, `server/storage.ts`, `server/routes.ts` | Quoten, Reservierungen, Cleanup, gespeicherte Aggregate; abgeschlossene Downloadlieferungen erhöhen Zähler. IP-Hash-/User-Schlüssel für Limits. | Service/Abwehr (b)/(f). | Rate-Limitfenster ≠ Löschfrist; kein personenbezogenes Audience-Tracking daraus ableiten. Ein Viewfeld allein belegt keinen funktionierenden Besuchszähler. |
| Kontakt | Mail-/Telefondaten, Nachricht; VCO und Kommunikationsanbieter. | Vertragsbezug (b), sonst Antwortinteresse (f). | Bearbeitungsbedarf, Aufbewahrungspflichten/Ansprüche; Mailprovider und Löschorganisation offen. |

## Gerät / Frontend

- `client/src/index.css`: beide aktiven Fonts lokal gebündelt. CSP-Erlaubnis
  für eine fremde Domain ist **kein** Nachweis, dass sie geladen wird.
- Suche nutzt URL-Parameter; keine aktive localStorage-/sessionStorage-Präferenz
  gefunden. `SidebarProvider` wird in aktiven Layouts nicht verwendet.
  Die ungenutzte Komponente schreibt `sidebar:state` für sieben Tage und
  müsste vor Aktivierung nach § 25 TDDDG beurteilt werden.
- Keine aktiven Trackingpixel/Analytics-, Social- oder externen Video-Embeds
  in den Galeriepfaden gefunden. Historische Profil-/Cover-/Serien-URLs können
  externe Bilder laden: Hostliste, Tracking und Notwendigkeit prüfen.
- Stripe-Abhängigkeiten/CSP und historische Zahlungsfelder sind kein aktives
  Beta-Checkout. Keine kostenpflichtige Lizenz, Auszahlung oder Zustimmung
  aus Registrierung/Download ableiten.

## Geplant, aber hier nicht als implementiert angenommen

Realer Resend-Betrieb, öffentliche Freigabe, Hosting-/VM-Entscheidung,
Vertrags-/Transferfreigabe, Altersregel, bindende Terms/Lizenzen,
vollständige Löschorganisation, DSA-Meldungen/Begründungen/Beschwerden.
Vor Änderungen die öffentliche Privacy Policy erneut mit dem tatsächlichen
Betrieb abgleichen. Für priorisierte Entscheidungen siehe
`docs/legal-change-and-gap-report.md`.
