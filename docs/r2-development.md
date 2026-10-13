# R2-Entwicklungsarchitektur und Betrieb

Stand: 12 October 2026. Dies ist **keine Produktionsfreigabe**. Ergebnisbericht:
[r2-migration-report.md](r2-migration-report.md).

**Konfigurationsnachtrag, 13 October 2026:** Für aktuelle Development-/Production-
Variablen, getrennte `R2_DEV_*`/`R2_PROD_*`-Credentials und die Account-weite Grenze
des read-only Audit-Tokens gilt [r2-environment-configuration.md](r2-environment-configuration.md).
Die untenstehenden ursprünglichen generischen Credential-Namen und die pauschale
Produktionssperre sind durch die dort beschriebenen expliziten Umgebungs-/Freigabegates
ersetzt. Weiterhin keine Produktionsfreigabe; echte R2-Prüfung erst nach Bestätigung.

## Architekturentscheidung

Ein privater R2-Standard-Bucket je ausdrücklich isolierter Umgebung, mit **EU-Jurisdiction**.
Kein zusätzlicher öffentlicher Bucket. Die vorhandenen logischen Präfixe `media-` und
`thumb-` bleiben unverändert; keine neue Verzeichnisstruktur oder URL-Umschreibung.
EU-Bucket-Speicherung bedeutet nicht, dass öffentlich freigegebene Vorschaukopien in
globalen Cloudflare-Caches ausschließlich in der EU liegen. Dies vor einem Rollout
datenschutzrechtlich bestätigen.

Standard bleibt Replit. R2 und Provider-Routing sind Entwicklungsschalter; beide werden
in `NODE_ENV=production` zurückgewiesen. Migration ist ein separater CLI-Prozess,
kein Start-up-Job. Keine Produktions-DDL, keine Quelllöschung, kein dauerhafter Dual-Write.

### Verträge und Verbraucher

| Objekt/Funktion | Vertrag und Auflösung |
|---|---|
| Original/Ableitung | `/api/media/files/media-UUID.ext`; IDs, Endung, UUIDv8-Markierung für Creator-Originale bleiben erhalten |
| Vorschau/Poster | `/api/media/files/thumb-UUID.webp`; gemeinsame Auflösung, nur ausdrücklich öffentliche, nicht Premium-Vorschauen dürfen zum Entwicklungs-Worker |
| Upload/Nextcloud | `uploadMedia` → `putMediaObject`; vorhandene Reservierungen, Creator-Quoten, MIME-/Decoderprüfung, Safety-Gates und kompensierende Cleanup-Einträge bleiben |
| Analyse/Safety/Caption | gemeinsamer `readMediaStream`; Bildaufbereitung unverändert, FFmpeg liest das private geroutete Original mit begrenzten Temp-Dateien |
| Video/Range | `readVideoSource` nutzt denselben Provider; Replit-GCS-Zugriff ist jetzt im Replit-Adapter, R2 nutzt HEAD und GET/If-Match |
| Downloads/Low-Res | vorhandene Rechteprüfung, Qualität/Entitlements, On-demand-Low-Res und Proxy-Completion; keine zusätzliche permanente Variante |
| Galerie-/Event-Bilder | bestehende Thumbnail-Auswahl und Fallback bleiben; Edge verwendet dieselbe aktuelle Freigabepolitik, zusätzlich veröffentlichtes Event und keine Premium-Flags |
| Reservierung/Cleanup | persistenter Provider vor Netzwerk-Write; unvollständige Uploads bleiben sichtbar für Wiederholung; Cleanup prüft registrierte Objekte transaktional, auch wenn ein älterer Prozess Replit-Defaults nutzt |
| Referenzdokumente | eigene Replit-Clients, `reference-UUID.ext`/private Referenzrouten; Inventar zählt sie, Migration kopiert sie nicht |
| Profil/Deckbild | derzeit normalisierte Data-URLs in PostgreSQL; inventarisiert, nicht konvertiert; parallele Profilbildarbeit nicht umgestaltet |
| Legacy Base64/externe URLs | separat gezählt, bisherige Leser unverändert; keine automatische Bereinigung |

`media_object_routes` enthält Provider, pending/verified/deleted, tatsächlichen SHA-256,
Größe/MIME, Objektversion, zurückgehaltene Quellversion und Quellnachweis.
`media_object_migrations` ist das dauerhafte Fortschritts-/Fehlerjournal mit
Zuordnungsfingerprint. Dieser umfasst Medien-/Event-ID, beide URLs, Eigentümer,
Premium-/Freigabe-/Safety-Versionen und Status. Vor Aktivierung/Zurückwechsel werden
die zugehörigen Datenbankzeilen gesperrt und erneut verglichen.

Unregistrierte Schlüssel bleiben Replit. Neue Dateien werden genau einmal beim gewählten
Provider geschrieben; bei aktiviertem Routing werden die Zielbytes vor Freigabe tatsächlich
gelesen und gehasht. Registrierte Reads prüfen Größe/MIME und die gespeicherte Version,
GET ist an diese Version gebunden. ETag dient **nicht** als SHA-256.

**Kein automatischer Fallback:** R2-401/403, Integritäts-, Konfigurations- und
Transportfehler können nicht durch Lesen einer möglicherweise älteren Replit-Datei
umgangen werden. Nur ein ausdrücklich ausgeführter, byteverifizierter Rollback darf
den Provider auf eine zurückgehaltene Quelle wechseln. Fehlende Konfiguration und
fehlendes Schema scheitern geschlossen. Das Abschalten des Routing-Schalters wird beim
App-Start verweigert, solange R2-/Retained-Records existieren.

## Cloudflare-Konfiguration

Vor tatsächlichen Tests vom Betreiber bereitstellen und belegen:

1. Isolierten Bucket mit Suffix `-dev` oder `-test`, Jurisdiction **EU**, Standard-Klasse;
   ein `weur`-Location-Hint ist kein Ersatz. Jurisdiction lässt sich nicht nachträglich ändern.
2. R2-S3-Endpunkt `https://<account-id>.eu.r2.cloudflarestorage.com`, Region `auto`.
   Generischer oder abweichender Endpunkt wird zurückgewiesen.
3. `r2.dev` deaktiviert, alle **direkten Bucket-Custom-Domains deaktiviert**;
   keine öffentlichen ACLs, kein öffentliches Schreiben, keine automatische
   Lifecycle-Löschung von Migrationsquellen.
4. S3-Zugang **Object Read & Write, nur dieser Entwicklungs-Bucket**, nicht Account-Admin.
   Ein eigener nur lesender Cloudflare-API-Audit-Token prüft Bucket-Einstellungen.
   Berechtigungsumfang vom Betreiber unabhängig prüfen; erfolgreiche PUT/GET-Proben
   allein beweisen keine Begrenzung auf diesen Bucket.
5. Worker-Binding `MEDIA` auf denselben privaten Bucket, `jurisdiction="eu"`;
   Beispiel `workers/media-preview/wrangler.example.toml` ist **nicht deployt**.
   Standard-`workers.dev` und Preview-URLs sind darin deaktiviert. Für echte Cache-Tests
   wäre eine separat freigegebene, isolierte Worker-Route/Domain erforderlich.
   Cloudflare-Access-vorgelagerte Worker unterstützen die Cache API derzeit nicht.
6. Keine Cache-Everything-Regel, Service-Worker-Cache oder vorgeschaltete Cache-Regel,
   die `no-store` des Worker-Browser-Responses überschreibt. App-Autorisierungsroute
   niemals cachen. Produktionsroute/Domain darf noch nicht eingerichtet werden.

### Replit Secrets — nur Namen, keine Werte

| Name | Zweck |
|---|---|
| `R2_ACCESS_KEY_ID` | Bucket-begrenzter S3-Zugang |
| `R2_SECRET_ACCESS_KEY` | dazugehöriges S3-Secret, ausschließlich Server |
| `R2_AUDIT_API_TOKEN` | nur lesender Einstellungen-Audit, nicht im Browser oder Worker |
| `MEDIA_EDGE_AUTH_SECRET` | mindestens 32 Zeichen, App und Worker; Worker separat als Secret hinterlegen |

Vorhandene Replit-/Datenbank-/Nextcloud-Secrets bleiben unverändert. Keine Credentials
in URL, Log, Bericht, TOML oder Client-Bundle.

Nicht geheime Entwicklungsvariablen:
`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_JURISDICTION=eu`, `R2_STORAGE_CLASS=Standard`,
optional `R2_ENDPOINT` (muss exakt stimmen), `MEDIA_STORAGE_ROUTING=enabled`,
`MEDIA_STORAGE_PROVIDER=replit|r2`, optional `MEDIA_EDGE_ORIGIN` (isolierte HTTPS-Origin).
Worker: `DEVELOPMENT_ONLY=true`, `APP_ORIGIN` (isolierte HTTPS-App-Origin).
CLI: `NODE_ENV=development`, `MEDIA_MIGRATION_ISOLATED=confirmed`,
`MEDIA_MIGRATION_DATABASE_NAME` (muss exakt zum separat verifizierten isolierten
`DATABASE_URL` passen), `R2_BUCKET_SCOPED_TOKEN_REVIEWED=true` nur nach Prüfung.
Diese Bestätigungsschalter sind **Betreiberbestätigungen, kein automatischer Nachweis**,
dass eine beliebig benannte Datenbank/Bucket tatsächlich von Produktion getrennt ist.

## Revokationsmodell öffentlicher Vorschauen

1. App-Link bleibt kompatibel. Nur aktuell erlaubte R2-Vorschau kann nach
   `/preview/thumb-UUID.webp/<sha256>` umleiten.
2. Vor **jedem** Cache-Hit fragt der Worker die App per POST ab. HMAC bindet Schlüssel,
   Digest und Zeitstempel; maximal ±15 Sekunden, konstanter Signaturvergleich.
   Dies ist kein Browser-Bearer-Downloadtoken. Wiederholung derselben HMAC-Anfrage
   gibt keine Rechte: die App prüft erneut aktuelle Freigabe/Eigentümersperre/Safety.
3. App prüft exakte Thumbnail-Zuordnung, Event `published`, öffentliche Media-Policy,
   keine Premium-Flags, R2/verified, WebP und **unter 100.000 Bytes**.
   Eigentümer-/Adminrechte alleine reichen nicht.
4. Auf Cache-Miss liest der Worker ausschließlich diesen Key, prüft Größe, MIME und
   SHA-256 der tatsächlichen Bytes. Interner Cache ist versioniert, maximal 1 Stunde,
   nicht über seine interne URL abrufbar; Cache ist pro Cloudflare-Rechenzentrum.
5. Browserantwort **`private, no-store`**. Bewusste Abweichung vom Wunsch nach
   Browser-Caching zugunsten sofortiger Berechtigungsprüfung: eine positive Browser-TTL
   würde einen widerrufenen alten Link ohne neue Prüfung weiter bedienen.
6. Nach DB-Commit einer Zurücknahme werden neu autorisierte Requests abgewiesen,
   auch bei warmem Cache. App-/Auth-Ausfall ergibt 503, nie stale-on-error.
   Interne Cachekopien dürfen bis TTL auslaufen, sind aber nicht mehr auslieferbar;
   globale Purges sind deshalb keine Voraussetzung für Rechteentzug.
   Bereits autorisierte laufende Antworten sowie bereits empfangene/gespeicherte Bytes
   lassen sich technisch nicht zurückholen. Gleiches Snapshot-Modell wie beim bisherigen Proxy.

Die Original- und Downloadrouten werden nicht auf Edge umgeleitet.

## Geschützte Downloads und Browseruploads

R2-/Replit-Adapter verweigern Signing. Kein geschützter Edge-Transfer und keine
presigned S3-URL sind aktivierbar. Der bestehende Proxy prüft bei jeder
Download-Anfrage aktuelle Sitzung, Eigentum, Sperrung und Entitlements, Premium bleibt
unverändert. Die Ausgabe einer Operation zählt nicht; der serverseitig vollständig
beendete Pipeline-Transfer zählt, idempotent pro Operation. Abbruch zählt nicht.
Dies beweist weder Schreiben auf der Festplatte noch genau einmalige Benutzung eines Links.

Ein Edge-Gegenentwurf bräuchte pro Request einschließlich Range dieselben aktuellen
Prüfungen, authentifizierte Completion-Ereignisse mit persistenter Deduplizierung,
klaren Regeln für Teilbereiche/Wiederholungen/Abbruch und genau das heutige
Completion-Kriterium. Worker-Response-Erzeugung, R2-GET oder Logeintrag beweisen keine
vollständig an den Client gesendete Antwort. Ein HMAC-Callback könnte sich
authentifizieren lassen, würde dieses Messproblem aber nicht lösen. Deshalb wird
kein vermeintlich gleichwertiger Prototyp freigeschaltet; Proxy bleibt.

Direkte Browseruploads würden zusätzlich Staging-Keys, begrenzte einmalige Reservierungen,
HEAD/Bytehash/Decoderprüfung, Finalisierung, Timeout-/Orphan-Behandlung und
Verhinderung von nachträglichen Überschreibungen benötigen. Eine presigned PUT-URL
allein ersetzt Quoten/Safety nicht. Ohne einen nachweisbar ebenso einfachen sicheren
Ersatz bleibt der serverseitige Uploadpfad erhalten.

## Werkzeuge — ausschließlich isolierte Entwicklung

`npm run test:r2` erstellt eine **wegwerfbare lokale PostgreSQL-Datenbank** und
lokale Provider-Fixtures. Verwendet keine verbundene/produktive Datenbank und keine
realen Cloudflare-Zugänge. Native PostgreSQL- und FFmpeg-Werkzeuge müssen vorhanden sein.

Für reale Infrastruktur erst Isolation und Secrets bestätigen, dann:

```sh
npm run r2:preflight
# Nur danach: additive Entwicklungsmigration im bestehenden Entwicklungsprozess,
# auf der zuvor separat verifizierten isolierten Datenbank, NICHT Produktion:
node --import tsx scripts/apply-dev-process-schema.mjs
npm run r2:migration -- dry-run
npm run r2:migration -- pilot media-<uuid>.<ext> thumb-<uuid>.webp
npm run r2:migration -- resume
npm run r2:migration -- reconcile
npm run r2:migration -- rollback media-<uuid>.<ext> thumb-<uuid>.webp
```

Preflight liest EU/Klasse und öffentliche Domain-Einstellungen, prüft eigene
8×8-WebP-Probe per PUT/GET und anonymem S3-GET und löscht **nur seinen eigenen**
isolierten Probe-Key. Least-privilege wird als manuelle Attestation getrennt ausgewiesen.
Fehlende Infrastruktur ist Status `blocked`, kein Erfolg.

Dry-run liest ausschließlich SQL-Inventar (Medien-IDs, Event-/Owner-IDs, Original/
Preview-Zuordnung, Legacy/Referenz/Profile-Ausschlüsse und Providerzustände).
Es listet keine fremden physikalischen Buckets und findet daher keine unbekannten
historischen Storage-Orphans; solche Objekte dürfen nicht pauschal gelöscht werden.
Pilot erfordert 1–8 explizite Keys. Resume verarbeitet Referenzen sequentiell, kann
auf explizite Keys begrenzt werden; es überschreibt keine Konflikte und kopiert
keine neuen R2-only-Uploads zurück/erneut. Gleiche vorhandene Targets werden erneut
an tatsächlichen Bytes geprüft, nicht nochmals hochgeladen. Reconciliation rehasht
Quelle und Ziel; unreferenzierte zurückgehaltene Quellen werden gesondert gelistet.
Fehlerjournal und Association-Konflikte verhindern stilles Aktivieren.

Pro Objekt maximal 100 MiB und private temporäre Arbeitsverzeichnisse, 120-Sekunden
Read-Deadline, S3-Request-Deadline 30 Sekunden, SDK maximal 2 Versuche; Datei-Writes
höchstens 2 Versuche mit frisch geöffnetem Stream. Pipeline-/Client-Abbruch zerstört
Streams; temporäre Dateien werden auch bei Fehlern entfernt. Quelle wird vor
Target-Write dauerhaft als retained markiert, **nie gelöscht**.

JSON-Berichte liegen unter `generated-artifacts/r2/` (Git und Deployment ausgeschlossen).
CLI-Fehler sind bereinigte Codes, Credentials werden nicht exportiert.

### Rollback

1. Neue Writes auf `MEDIA_STORAGE_PROVIDER=replit` setzen, **Routing enabled lassen**.
2. Edge-Umlenkung ausschalten (`MEDIA_EDGE_ORIGIN` entfernen); Worker-Autorisierung
   scheitert dann geschlossen, alte Edge-Links werden nicht weiter bedient.
3. Betroffene bestehende Migrations-Keys mit `rollback` zurückwechseln. Dieser
   prüft tatsächliche Quellbytes, Größe/MIME und aktuelle Zuordnung und setzt den
   Source-Provider transaktional; IDs/URLs bleiben identisch. Ziel bleibt erhalten.
4. Reconciliation, Rechte, Download und Range erneut prüfen. Replit-Quellschutz
   bleibt auch nach Rollback bestehen. Keine Tabellen/Flags/Quellen löschen.
5. **Neue R2-only-Uploads besitzen keine Replit-Quelle.** Sie weiter geroutet
   bedienen; globales Routing-Abschalten wäre Datenverlust/Defekt. Eine spätere
   Rückkopie benötigt eigenen verifizierten Ablauf und Freigabe.

### Monitoring und Freigabe

Vor späterem Cutover: Preflight-Bericht, alle Reconciliation-Fehler und
pending/error/retained-Zustände prüfen; Upload-/Delivery-/Range-Fehler und
Worker 403/404/503 sowie Cache-Hit/Miss und aktuelle Autorisierungszeiten beobachten.
Reconciliation nach Pilot, Rollen-/Policy-Änderung und vor jedem Providerwechsel;
fehlende Quell-/Zielobjekte als Fehler behalten. Preflight ist der minimale explizite
Speicher-Gesundheitscheck, kein neuer permanenter Dienst. Alarme/Budgetgrenzen für
Worker-Requests und R2-Operationen vor echten Lasttests festlegen.

Reale R2-/Edge-Tests, EU-/Token-/Domain-Nachweise und weltweite Latenzen fehlen derzeit.
Veröffentlichung, Produktionsschema, Domain-/Worker-Rollout, Produktionskopie,
Cutover und spätere Quellbereinigung brauchen jeweils ausdrückliche Freigabe.
