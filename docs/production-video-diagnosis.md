# Produktions-Videofehler: Diagnose und lokale Ergänzung

## Befund

Der gemeldete Smoke-Test scheiterte nach drei Jobversuchen. Die verfügbaren
Produktionslogs enthalten keine separaten Ursachen oder Fehlercodes dieser
Versuche. Der bisherige Code verwarf Werkzeugfehler und ersetzte alle Ursachen
durch allgemeine Jobmeldungen. Drei Jobversuche belegen keine drei KI-Anfragen.

FFmpeg ist als Nix-Abhängigkeit vorgesehen. Seine tatsächliche Version und die
erforderlichen Decoder in der laufenden VM wurden nicht durch neue
Produktionsoperationen geprüft. Der ältere erfolgreiche Videovergleich nutzte
einen lokalen Original-Leser und ist kein Nachweis für den späteren VM-Smoke-Test.
Eine unzureichende VM-Kapazität ist nicht nachgewiesen.

## Nach ausdrücklicher Zustimmung lokal ergänzt

- Stufen: Dateizugriff, Probe, Frameextraktion, KI-Anfrage, Ergebnisparsing,
  Datenbanklesen und Ergebnisspeicherung.
- Begrenzte Diagnoseprotokolle mit Medien-ID, Versuch, festem Fehlercode,
  Wiederholbarkeit, tatsächlichem Exitcode/Signal und gegebenenfalls HTTP-Status.
  Keine Rohantworten, Original-URLs, Bilddaten, Texte, Zugangsdaten oder rohes
  Werkzeug-stderr.
- Fehlende/unerreichbare Programme, unbekannte Werkzeugoptionen, erkannte
  Codec-/Formatprobleme und feste Eingabelimits beenden den Job ohne drei
  identische automatische Versuche.
- Netzwerk-/Providerstörungen, Rate Limits, unklare Decoderfehler, Unterbrechungen
  und Zeitlimits behalten den bestehenden begrenzten Wiederholungsmechanismus.
- Die unveränderten acht Sekunden je Prozess und 75 Sekunden für die gesamte
  Extraktion erhalten unterschiedliche Fehlercodes. Es wurden keine Limits erhöht.
- Originalobjekte, manuelle Metadaten, Bildanalyse, Uploadfunktion,
  Erkennungsmodell und Queue-Schema bleiben erhalten. Keine neue Infrastruktur.

## Prüfung

16 unterschiedliche Video-/Diagnose-/Parallelitätsfälle erfolgreich, einschließlich
synthetischer MP4/MOV/WebM-Dateien, einmaliger Ablehnung korrupter Originale ohne
KI-Anfrage, Teilresultat-Wiederverwendung, transienter Wiederholungen, Lease-Fencing,
fehlender Programme, Werkzeugoptionen, beider Zeitlimits und sicherer Logfelder.
Ein anfangs zu eng auf Exitcode 1 beschränkter Test wurde korrigiert:
der lokale FFmpeg meldet bei unbekannter Option Exitcode 8.
Typprüfung und Produktionsbuild erfolgreich.

Alle KI-Testantworten waren gemockt. Testkonsumenten wurden auf ihre eigenen
Fixtures begrenzt. Keine neuen Produktionsuploads, Live-Neustarts, Deployment-
Änderungen oder kostenpflichtigen Providertests.

## Noch offen

Die ursprüngliche Live-Ursache ist weiterhin nicht bestätigt. Erst nach
gesonderter Zustimmung zur Veröffentlichung und einem gezielten Nachtest können
die neuen Diagnosedaten eine konkrete Korrektur begründen. Wenn das Testoriginal
noch vorhanden ist, braucht der Nachtest keinen erneuten Upload.
Es sind keine zusätzlichen Dienste oder größeren VMs vorgesehen; Kosten eines
späteren echten KI-Nachtests sind ohne Umfang und Tokenverbrauch nicht bezifferbar.
