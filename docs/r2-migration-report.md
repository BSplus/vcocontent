# Later real Development connectivity evidence

The first authorized bucket-only Development object probe is documented separately
in [r2-development-connectivity-report.md](r2-development-connectivity-report.md).
Upload, actual read/SHA-256 and cleanup succeeded. The historical overall probe
FAIL came from an invalid unsigned-S3 public-access verification method, not
evidence of public exposure. The operator has completed the manual Development
bucket review. See [pilot readiness](r2-development-pilot-readiness.md) for remaining
source/tooling prerequisites. No real media pilot or provider/routing switch
followed. The earlier local-only measurements below remain historical
evidence, not live R2/Edge measurements.

# R2-Vorbereitung: Ergebnis und Freigabegrenzen

**Stand: 12 October 2026 — Entwicklung vorbereitet, kein produktiver R2-Nachweis.**

## 1. Ausgangspunkt und Umsetzung

Der bereitgestellte Audit nennt **415 produktionsreferenzierte Objekte,
ca. 309,49 MB Medien und ca. 147 MB PostgreSQL**. Dies ist die übernommene
Audit-Baseline, **keine neue Produktionsmessung**. Keine produktiven Daten,
Objekte, Schemaänderungen, Worker oder Domains wurden verändert.

R2-Standard-Adapter, EU-Endpunktprüfung, persistentes Provider-/Integritätsrouting,
private Range-Reads, Entwicklungs-Preview-Worker und Dry-run/Pilot/Resume/
Reconciliation/Rollback sind implementiert. Unveränderte Umgebungen bleiben Replit.
Eine kleine Abstraktion ersetzt direkte Medien-SDK-Abhängigkeit und den separaten
Videozugriff; private Referenzen und PostgreSQL-Profilbilder bleiben außerhalb.
Details, Konfiguration, Secret-Namen, Befehle und Rollback:
[r2-development.md](r2-development.md).

Offizielle Fotos behalten eine optimierte hochwertige Ableitung im **dezimalen
5.000.000-Byte-Budget**, ohne neue 2560px-Grenze, plus WebP-Vorschau im bestehenden
100.000-Byte-Budget. Edge nimmt nur **unter** 100.000 Bytes an; exakt 100.000 große
historische Vorschauen bleiben beim Proxy. Creator-Originale bleiben byteidentisch,
Quoten und bestehende Grenzen unverändert. Video-Poster/FFmpeg-Verarbeitung bleiben
bestehend; kein neuer Transcoding-Dienst oder permanente zusätzliche Bildvariante.

## 2. Nachweise und Blocker

| Bereich | Ergebnis |
|---|---|
| R2-S3-Vertrag | echte Adapterklasse gegen isolierten S3-Testtransport: PUT ohne öffentliche ACL, HEAD, ETag-gepinnter Range-GET, 404/403 und Signing-Verweigerung geprüft |
| Provider-Integration | tatsächliche Upload-/Read-/Download-/Analyse-/Cleanup-Routen mit wegwerfbarem PostgreSQL und Dateisystem-Fixtures; gemischte Provider und Ausfälle ohne Source-Fallback |
| Repräsentativer CLI-Pilot | 8 bereits angelegte synthetische Entwicklungsobjekte: offizielles Foto + Preview, byteidentisches Creator-PNG + Preview, gesperrtes Premium-Foto + Preview, echter MP4-Clip + Poster |
| Integrität/Zuordnung | tatsächliche Quell- und Zielbytes/SHA-256, Größe, MIME-Signatur, IDs/Owner/Visibility/Safety-Fingerprint; sequentieller Resume, kein zweiter Target-Write, Rollback ohne Quelllöschung |
| Fehlerprobe | Zielbytes absichtlich verändert: Reconciliation meldet Fehler; MIME-, Quellen-, Associations-Konflikte im isolierten Vertragstest; kein stiller Providerwechsel |
| Schutz | anonyme/Cross-Account-Draft-Reads abgewiesen; Owner erlaubt; Premium unverändert gesperrt; alte/warme Edge-Links nach Draft, Admin-Hide, Owner-Sperre oder Premium-Änderung abgewiesen |
| Edge | Test-Harness führt tatsächlichen Worker-Code und echte App-HTTP-Autorisierung aus; aktueller Check vor jedem Cache-Hit, falsche HMAC/Zeit/Digest/Keys abgewiesen, Auth-Ausfall 503 ohne Cacheantwort |
| Statistik | Operation-Ausgabe ohne Zähler, erfolgreicher Transfer zählt einmal trotz Wiederholung; bestehende Proxy-Abbruch-/Range-Regressionen bestanden |
| Video/KI | tatsächliche lokale HTTP-206/HEAD/416 und byteidentisches Full-GET; FFmpeg verarbeitet gerouteten R2-Fixture-MP4 in 5 eindeutige Analyseframes; Bild-KI-Eingaben aus gerouteten Quellen geprüft |
| Nextcloud/Quoten | vorhandene echte Import-/Upload-Routentests einschließlich real decodierbarer Videos, Wiederholung, Reservierungen und Cleanup bestanden; keine reale Nextcloud/R2-/KI-Dienstmessung |

Tests: `npm run test:r2` **6/6**, die ergänzende isolierte Medien-/Nextcloud/
Creator-/Download-/Range-Gruppe **34/34**; Videoanalyse/-Ingestion und Low-Res
im vorherigen isolierten Durchlauf jeweils bestanden. `npm run check` und
`npm run build` bestanden. Build meldet bestehende Bundle-Größen-/Browserslist-Hinweise;
AWS SDK kündigt Node-22-Bedarf für Veröffentlichungen ab Januar 2027 an.

Berichte werden reproduzierbar unter `generated-artifacts/r2/` erzeugt:
`pilot-representative.json`, `local-performance.json`, `local-video-performance.json`,
Modusberichte und `preflight.json`. Keine nicht überprüfte Produktionskopie wird als
Pilot ausgegeben. Die im Test erzeugten Quell-/Zieldateien liegen nur im später
verworfenen Testverzeichnis; keine bestehenden Cloud-Objekte werden gelöscht.

**Blockiert:** R2-Zugang, Account-/Bucket-Einstellungen, unabhängiger Nachweis der
Bucket-begrenzten Berechtigungen, isoliertes reales Entwicklungsziel und isolierte
Edge-Route/Domain sind nicht bereitgestellt. Preflight wurde ausgeführt und meldet
`blocked` (Konfiguration/Konnektivität), **keine** bestandene Cloud-Prüfung.
Reale R2-SHA-Pilotbelege, anonymer Live-Bucket-Read, globale POP-/Cache-Messungen
und reale KI-Erkennungsqualität sind offen. Secrets wurden nicht eingesehen;
nur ihr Vorhandensein geprüft. Dies ist kein veröffentlichungsreifer Cutover.

## 3. Begrenzte echte lokale Vergleichsmessung

Messzeitpunkt 12 October 2026, ca. 22:59 UTC. 12 Requests je Pfad, sonst
Concurrency 1; Parallelgruppe Concurrency 4. Gleiche synthetische 640×480-
Texturfoto-Datei: PNG-Original **923.793 Bytes**, WebP-Preview **95.790 Bytes**.
Echte lokale HTTP-Routen/SQL, **lokale dateibasierte Provider-Fixtures** und
Node-Worker-Harness; keine Cloudflare-POP-/Netzwerkwerte.

| Pfad | Median komplett ms | p95 ms | mittlerer Antwortbeginn ms |
|---|---:|---:|---:|
| bisheriger Replit-Proxy | 10,64 | 15,08 | 9,96 |
| R2-Fixture-Proxy | 13,48 | 19,32 | 13,04 |
| warmer Worker-Cache | 13,03 | 16,00 | 13,02 |
| Worker, 4 parallel | 20,12 | 26,16 | 20,54 |
| geschützter Original-Download | 21,14 | 29,12 | 14,92 |
| Event-Medien-API | 8,21 | 10,10 | 8,40 |

Warmer Cache: **12/12 Hits**, auch in Parallelgruppe. Miss → geprüfte
Bucketbytes → Cache wurde davor funktional geprüft, nicht als weltweite Cold-Start-
Latenz gemessen. Pro Preview lieferte die App statt **95.790 Bildbytes**
**93 tatsächlich gemessene Autorisierungs-JSON-Bytes**. Redirect-/HTTP-/TLS-Overhead
ist nicht enthalten; dies ist Payload, **keine Replit-Abrechnungszahl**.
Edge spart hier Bildtransfer, ist lokal aber **nicht schneller als der alte Proxy**:
die notwendige aktuelle Freigabe bleibt ein Backend-Request pro Bild.

Video: 32.526-Byte-MP4, 12 HTTP-Ranges à 1.024 Bytes;
mittlerer Antwortbeginn **8,94 ms**, komplett **9,16 ms**.
FFmpeg-Sampling **947,87 ms**, 5 eindeutige Frames.
Echte Decodierung und Range-Wiedergabegrundlagen geprüft, kein R2-Cloud-
Browser-Playback oder Performanceversprechen für die veröffentlichte VM.
Produktions-/globale Werte müssen im selben begrenzten Aufbau separat gemessen werden.

## 4. Geschützte Transfers — bewusste Entscheidung

Kein geschützter Edge-Download ist aktivierbar. Zeitbegrenzte Bearer-URLs erfüllen
weder Logout-/Owner-/Sperr-/Entitlement-Revokation noch die heutige Completion-
Statistik. Ein deduplizierter HMAC-Callback würde die Authentizität seiner Nachricht,
aber nicht die vollständige Endkundenübertragung beweisen.
Proxy bleibt inklusive Pipeline-Abbruch und idempotenter Operation-Completion.
Premium-/Credits-/Stripe-/Creator-Vergütung wurden nicht aktiviert oder geändert.
Browseruploads bleiben serverseitig validiert; der komplexere Staging-/Finalisierungs-
Gegenentwurf wurde bewertet, nicht eingeschaltet.

Bei Preview-Browser-TTL wird **no-store statt positiver TTL** gewählt, um nach einer
Zurücknahme jeden neuen Aufruf aktuell prüfen zu können. Das ist die ausgewiesene
Sicherheits-/Performance-Abwägung gegenüber dem Brief, keine behauptete Erfüllung
von dauerhaftem Browser-Caching. Interner Cache ist auf 1 Stunde begrenzt und
unterliegt vor jeder Auslieferung derselben aktuellen Prüfung.

## 5. Kostenmodell, nicht Rechnung oder Traffic-Prognose

Quellen abgerufen **12 October 2026**, USD ohne Steuern/Kontoguthaben:

- [R2 Pricing](https://developers.cloudflare.com/r2/pricing/), aktualisiert 1 October 2026:
  Standard **$0,015/GB-Monat**, 10 GB frei; Class A **$4,50/Million**,
  1 Million frei; Class B **$0,36/Million**, 10 Millionen frei; Egress kostenlos.
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/),
  aktualisiert 2 October 2026: Paid mindestens **$5/Monat**, 10 Millionen Requests
  und 30 Millionen CPU-ms enthalten; Mehrverbrauch $0,30/Million Requests,
  $0,02/Million CPU-ms; kein zusätzlicher Worker-Egresspreis.
- [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/),
  aktualisiert 14 August 2026: lokal pro Rechenzentrum, kein global replizierter
  Cache. Hier kein separates kostenpflichtiges Cache-/Image-Resizing-Produkt eingeplant.
- [Replit App Storage](https://docs.replit.com/billing/object-storage-billing):
  **$0,015/GiB-Monat**, Transfer Upload+Download **$0,05/GiB**,
  Basic $0,0004/1.000, Advanced $0,005/1.000; Mindestabrechnung 7 Tage.
- [Replit August-Preise](https://docs.replit.com/billing/aug-cloud-billing-updates):
  Deployment-Outbound seit August **$0,05/GiB**.
  [Deployment-Preise](https://docs.replit.com/billing/deployment-pricing):
  z.B. Dedicated 1 vCPU/4 GB $35/Monat; hier **nicht** zusätzlich berechnet.

S ist durchschnittlicher monatlicher Speicher in dezimalen GB, TB=1.000 GB.
Annahmen: N=S×1.000 gespeicherte Objekte, durchschnittlich 1 MB inklusive Mix;
P=20N Previewabrufe à 90 KB, D=0,2N Downloads à 4 MB, W=0,1N Writes/Monat;
90% Edge-Hits, 2 CPU-ms/Worker-Request, 1 KiB pro Preview-Autorisierungsantwort
inklusive geschätztem Protokollanteil. Protected-Edge-Szenario zusätzlich zwei
1-KiB-Kontrollantworten pro Download. Kein Wiederholungs-/Bot-/Range-Zuschlag.
Freikontingente gelten **accountweit** und sind hier andernorts unverbraucht angenommen.

Formeln: R2-Speicher `max(S−10,0)×0,015`;
Replit-Speicher `S/1,073741824×0,015`. Replit-Quelle 2,7S GB monatlicher
Upload+Download, App-Outbound 2,6S GB. Proxy-R2-Class-B:
`2(P+D)+2W` (HEAD+GET sowie Uploadverifikation).
Cached-R2-Class-B `0,1P+2D+2W`.
Workerkosten `$5 + max(R−10M,0)×0,30/M + max(2R−30M,0)×0,02/M`.

Konservativ folgt die Replit-Operationszuordnung dem Wortlaut der Dokumentation:
Updates Basic, Abrufe Advanced. Bei abweichender tatsächlicher Klassifizierung
ändern sich diese Beträge deutlich; vor Cutover mit Usage-/Rechnungsdaten abgleichen,
statt GCS/R2-Klassen ungeprüft gleichzusetzen. Quelltransfer und App-Outbound sind
unterschiedliche Strecken; beide sind im Modell ausgewiesen, keine gemessene
doppelte Kontobelastung behauptet.

### Nur Speicher pro Monat

| Archiv | Replit | R2 Standard inkl. angenommenem freien 10 GB |
|---|---:|---:|
| 100 GB | $1,40 | $1,35 |
| 500 GB | $6,98 | $7,35 |
| 1 TB | $13,97 | $14,85 |
| 5 TB | $69,85 | $74,85 |

### Speicher + angenommene Operationen/Transfer/Worker pro Monat

| Archiv | Replit-Proxy | R2, alle Transfers im Proxy | R2-Preview-Edge, geschützter Proxy | theoretischer privater Edge, **nicht aktiviert** |
|---|---:|---:|---:|---:|
| 100 GB | $36,18 | $13,46 | $10,17 | $6,45 |
| 500 GB | $180,91 | $71,59 | $31,45 | $12,87 |
| 1 TB | $361,81 | $146,94 | $61,26 | $24,09 |
| 5 TB | $1.809,05 | $749,69 | $302,36 | $116,53 |

Reproduzierbar: `node scripts/r2-cost-model.mjs`; detaillierte Komponenten und
Requestzahlen im JSON. Beispielsweise 5 TB: R2-Proxy-Class-B $69,48,
Cached-Class-B $1,08, Preview-Worker $35,40 bei 100 Millionen Previewrequests.
Die letzte Spalte ist **nur eine Kostenuntergrenze für eine bislang nicht
gleichwertig sichere Alternative**, kein Feature oder Freigabeversprechen.

Während Migration/Rollback-Vorhaltung kommt bei allen R2-Spalten die behaltene
Replit-Speicherung hinzu ($1,40/$6,98/$13,97/$69,85), solange keine separat
genehmigte Bereinigung erfolgt. Der byteverifizierte Kopierlauf liest Quellen
mindestens zweimal; Modell-Zuschlag Quelltransfer `2S/1,073741824×$0,05`
plus Replit-GET/HEAD, R2-PUT/GET/HEAD und spätere vollständige Reconciliation.
Resume verifiziert erneut: Idempotenz heißt nicht kostenloser Wiederholungslauf.
VM/PostgreSQL/KI/Nextcloud, neue Lastreserve, Control-API-CPU, Mail, Domain,
Cache-Analytics, Monitoring und denkbare externe Gebühren sind **nicht** enthalten.
Die Replit-App bleibt erforderlich; R2 allein entfernt ihre Netzwerk-/CPU-Kosten nicht.

## 6. Vor späterer Produktionsfreigabe

1. Isolierte reale R2-/App-/Worker-Infrastruktur und begrenzte Secrets bereitstellen;
   Preflight samt unabhängiger Berechtigungsprüfung und direkten Domain-Denials belegen.
2. Den 8-Objekt-Pilot mit genehmigten **vorhandenen Entwicklungsmedien** tatsächlich
   in R2 durchführen; SHA, Wiedergabe, Rechte, Downloads und KI-Eingaben samt
   Rückwechsel dokumentieren. Lokale Fixture-Belege ersetzen diese Prüfung nicht.
3. Globale Preview-/Cache-/API-/Download-/Video-Messungen, EU-Datenhaltung vs.
   globales Preview-Caching, Budgets und Monitoring bestätigen.
4. Erst separat genehmigtes Produktionsschema, Worker/Domain und kontrollierte
   Kopie/Cutover planen. Produktionscode-Gates müssen dafür bewusst freigegeben
   werden, nicht bloß Secrets gesetzt. Vor Cutover vollständige Reconciliation
   und Rollbackfähigkeit einschließlich neuer R2-only-Uploads bestätigen.
5. Quelllöschung bleibt nochmals separat freigabepflichtig. Kein Legacy-Base64-,
   Referenz-/Profilbild- oder PostgreSQL-Migrationslauf ist enthalten.
