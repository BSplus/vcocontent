---
name: Beta mail setup
description: User-reported Resend configuration and the sending domain for beta emails.
---

Der Nutzer meldet: „Resend ist jetzt konfiguriert. Also die Domain updates.vco-esports.com“.

**Why:** Der Nutzer hat die zuvor verschobene Einrichtung als konfiguriert gemeldet.

**How to apply:** Resend nicht mehr als bewusst verschoben behandeln. Die gemeldete Versanddomain ist updates.vco-esports.com. Die Meldung ersetzt weder die Prüfung der App-Konfiguration noch einen Zustellungstest und ist keine Freigabe zur Veröffentlichung oder zum Umgehen der Verifizierung.

Die Mailbereitschaft immer am laufenden veröffentlichten Prozess prüfen, nicht allein anhand vorhandener Workspace-Secrets.

**Why:** Vorhandene Resend-Secrets und eine gültige Versandkonfiguration im Workspace gingen bei einem Live-Test mit einer abgelehnten Konfigurationsprüfung im veröffentlichten Prozess einher. Workspace-Verfügbarkeit beweist keine Übernahme in den aktiven Deploy.

**How to apply:** Die aktive Live-Registrierung beziehungsweise den authentifizierten Versandstatus prüfen. Bei fehlender Live-Konfiguration die Publishing-Einstellungen und eine erforderliche erneute Veröffentlichung benennen, ohne eigenständig Produktionswerte zu ändern oder zu veröffentlichen. Provider-Annahme und bestätigte Inbox-Zustellung getrennt ausweisen.
