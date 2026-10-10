# VCO Rechtstexte – Änderungen, Lücken und Freigabepunkte

Stand: 10. Oktober 2026. **Textanpassung, keine Rechtsberatung oder abschließende
Rechtskonformitätsgarantie. Keine Veröffentlichung, Hostingänderung oder AVV
durchgeführt.** Die bereits integrierte Beta wurde erneut geprüft.

## Fertig angepasste Texte

- `/imprint`: Betreiberangaben mit § 5 DDG, DE331164657 statt Steuernummer,
  HRB 255920, Vertretung, redaktioneller Verantwortung und Verbraucherstreitbeilegung
  entsprechend der aktuellen Hauptseite. Alte TMG-Bausteine und pauschale
  Haftungsfreistellungen entfernt; lokale/funktionierende Kontaktlinks.
- `/privacy-policy`: öffentlich ohne Login, Englisch, mit Konto/Creator,
  Veröffentlichung, indirekter Datenerhebung, privaten Referenzen und abgeleiteten
  Namen, Serverimporten, Bildern/Video-Frames, Safety-/Blockentscheidungen,
  Resend, Sessioncookie, Empfängern/Transfers, tatsächlichen Retentiongrenzen,
  Rechten und BayLDA. Keine fremden Auth-/Social-/Tracking-Flows kopiert.
- Rechtslinks in gemeinsamen Footern, Legal-Seiten, Auth, Creatoraktivierung,
  Dashboard, Medienupload und Referenzanlage. Keine Zustimmung zur Privacy Policy,
  keine neue Consent-Checkbox oder rückwirkende Akzeptanz.
- Einheitlicher Rechtevorbehalt in Footer, Impressum, Creatorhinweis,
  Mediendetail und Download-Lightbox: kostenloser Download ist keine
  private/redaktionelle/kommerzielle Lizenz; gesetzliche Rechte bleiben unberührt.
- Reviewentwurf `docs/gallery-creator-terms-review.md` liegt **nur im Repository**;
  er ist keine öffentlich geltende AGB oder Rechteübertragung.
- Belege/Verarbeitung: `docs/legal-processing-register.md`.

## Priorisierte Betriebs- und Produktlücken

| Priorität | Was wirklich fehlt | Erforderliche Entscheidung / Prüfnachweis |
|---|---|---|
| **P0 vor öffentlichem Start** | Auftragsverarbeitung / Drittlandtransfers | Betreiber muss tatsächliche Replit-/Storage-/DB-/AI-/Resend-/Mail- und Nextcloud-Vertragskette, Verantwortlichen-/Auftragsverarbeiterrollen, AVVs nach Art. 28, Unterauftragnehmer, Regionen und Art. 44–49-Mechanismen belegen. SCC/Angemessenheit/TIA und zusätzliche Maßnahmen nur soweit tatsächlich erforderlich und vereinbart bestätigen. SDK oder Secretname ist kein Nachweis. Public Policy anschließend präzisieren. |
| **P0** | Rechte und Vertragsmodell | Entscheiden: welche konkrete Nutzung Nutzer erhalten, wer sie erteilen darf, begrenzte Betriebslizenz/AI-Verarbeitung, Attribution und Persönlichkeitsrechte. Bestehende Rechtehistorie/Akkreditierungen klären. Öffentlich bleibt bis dahin nur der Rechtevorbehalt, nicht ein erfundenes “private use permitted”. |
| **P0** | DSA-Melde-/Begründungsweg | Juristisch als eigener redaktioneller Dienst, Hostingdienst bzw. Onlineplattform einordnen; Art. 11/12 Kontaktstellen und Art. 14 klare Regeln/Moderation festlegen. Art. 16 elektronisches Verfahren mit Pflichtangaben/Ausnahmen, Empfangsbestätigung und Ergebnis; Art. 17 konkrete Begründungen, Automation und Rechtsbehelfe; Art. 18 Behördeneskalation prüfen/organisieren. Text-E-Mailhinweis und Admin-Reason-Feld reichen als vollständiger Nachweis nicht. |
| **P0** | Menschliche Prüfung / KI-Risiko | Art. 22 für automatische Registrierung-/Aktivierungs-/Publikationsrestriktionen bewerten (nicht jede Sperre ist automatisch rechtlich erheblich, aber auch keine pauschale Verneinung). Geeignete Admin-Zweifelsfallprüfung deckt falsch-positive „prohibited“-Entscheidungen nicht vollständig ab. Wirksame menschliche Neubewertung, Verantwortliche/Befugnisse, Fristen, Korrekturweg und Art. 35 DSFA-Schwelle dokumentieren. Sensible Inhalte/Art. 9, Kinder und Fehler-/Biasrisiken prüfen. Keine biometrische Identitätszusage. |
| **P0** | Alters- und Informationspflichten | Mindestalter/Vertragsfähigkeit und ggf. Elternbeteiligung entscheiden; derzeit keine Altersprüfung. Abgebildete Minderjährige und erreichbare Informationen nach Art. 13/14, Art.-14-Ausnahmen nur begründet, nicht pauschal annehmen. DSA-Minderjährigenschutz nach tatsächlicher Einordnung gesondert prüfen. |
| **P0/P1** | Löschorganisation | Zuständige und Ablauf für Auskunft, Berichtigung, Erasure, Widerspruch/Restriktion; vollständiges Dateninventar, Fristen für Konten/Verifizierung/Jobs/Referenzen/Safety/Reviews/IP-Hash-Limits/Logs/Backups festlegen. Cleanupqueue ist vorhanden, aber keine vollständige Kontolöschung. 1-h-Link/7-Tage-Cache/24-h-Manifest sind keine generellen Löschfristen. Fehlgeschlagene Objektlöschung, Providerkopien und indirekte Daten zusammenführen. |
| **P0/P1** | Externe Altbilder / Gerätezugriff | Tatsächlich öffentlich geladene Fremdhosts inventarisieren, Tracking/Transfer und § 25 prüfen; ggf. lokale Auslieferung oder echte vorherige Zustimmung gesondert umsetzen. Aktuell kein aktiv verwendeter Sidebar-Präferenzcookie; dessen Aktivierung neu bewerten. Kein pauschales “kein Banner nötig” aus lokal gebündelten Fonts ableiten. |
| **P0 separat** | Betriebsbereite Beta | Reale Resend-Absender-/Zustell-/Originprüfung, Storage/DB/AI in Produktionslaufzeit bestätigen; keine Versandkonfiguration oder VM-Migration aus diesem Texttask ableiten. Bereits vorhandene Beta-/Hostingaufgaben bleiben zuständig; kein paralleler Umbau. |
| **P1 / nach Einstufung** | Weitere DSA-Pflichten | Unternehmens-/Konzern-Größenkriterien und konkrete Ausnahmen prüfen. Art. 15/19 und Art. 20 ff./24/28 getrennt bewerten; eine mögliche kleine-Plattform-Ausnahme beseitigt nicht pauschal Art. 11/12/14/16/17/18. VSBG-Verbraucherstreitbeilegung im Impressum nicht mit ggf. DSA-Streitbeilegung verwechseln. |

**P0** = Entscheidung/Nachweis bzw. notwendiger Prozess vor öffentlicher Beta;
**P1** = konkret zu terminierende Ergänzung nach juristischer Einordnung, nicht
Erlaubnis zur ungeprüften Fortsetzung. Technische Folgearbeit erst nach Freigabe.

## Nächste Betreiberfreigabe

1. Verantwortlichen für Datenschutz-/Contentmeldungen und juristische Prüfung
   benennen; Produktentscheidungen zu Alter, Lizenz, Vertrag und Beendigung treffen.
2. Anbieter-/Transferakte und Löschkonzept liefern; externe Altbilder inventarisieren.
3. DSA- und KI-Entscheidungsprozesse rechtlich einstufen, praktisch besetzen und
   erforderliche technische Umsetzung separat beauftragen.
4. Erst nach diesen Nachweisen öffentliche Policy/Terms präzisieren und
   öffentliche Freigabe separat genehmigen. Der englische Hinweis zu noch offenen
   Betriebsbestätigungen ersetzt **keine** Pflichtinformation/Transfergrundlage.

## Verifikation

Fokussierte Regressionen stehen in `tests/legal-pages.test.mjs`:
öffentliche Direktaufrufe und Server-Titel, mobile Breite/Schriftgrößen,
Rechtsnavigation ohne Login, nicht als Zustimmung gestaltete Auth-Information,
Creatorhinweise/Uploadkontext mit synthetischen Rollen und übereinstimmender
Rechtevorbehalt. Keine realen Konten oder Medien werden dafür angelegt.
`npm run check` und `npm run build` sind zusätzlich erforderlich.
Die Tests prüfen Texte/Navigation, **nicht** Verträge, echte Providerfristen oder
Rechtskonformität. Livezustellung und angemeldete Produktions-UI werden dadurch
nicht bestätigt.

Prüfergebnis: Typprüfung und Produktionsbuild bestanden. Öffentliches
Privacy-Layout zusätzlich bei 390 × 844 px visuell geprüft; keine horizontale
Überbreite in den Browserchecks. Der Build meldet vorhandene Hinweise zu altem
Browserslist-Datenstand und großer Bundlegröße. Die Vorschau startet auf Port
5000, meldet jedoch „Analysis queue unavailable“; die Legal-Seiten sind hiervon
unabhängig erreichbar. Kein erfolgreicher Live-KI-/Datenbankbetrieb wird aus
diesen Checks abgeleitet.
