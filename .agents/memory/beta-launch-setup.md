---
name: Beta mail setup
description: User-reported Resend configuration and the sending domain for beta emails.
---

Der Nutzer hat den gewünschten Absender auf die Domain vco-esports.com umgestellt. Die zuvor eingerichtete Versanddomain war updates.vco-esports.com.

**Why:** Der Nutzer hat den Wechsel der Versanddomain ausdrücklich mitgeteilt.

**How to apply:** vco-esports.com als gewünschte Versanddomain behandeln, nicht mehr updates.vco-esports.com. Die neue Domain nicht ohne Prüfung als verifiziert ansehen. Die Meldung ersetzt weder die Prüfung der App-Konfiguration noch einen Zustellungstest und ist keine Freigabe zur Veröffentlichung oder zum Umgehen der Verifizierung.

Die Mailbereitschaft immer am laufenden veröffentlichten Prozess prüfen, nicht allein anhand vorhandener Workspace-Secrets.

**Why:** Vorhandene Resend-Secrets und eine gültige Versandkonfiguration im Workspace gingen bei einem Live-Test mit einer abgelehnten Konfigurationsprüfung im veröffentlichten Prozess einher. Workspace-Verfügbarkeit beweist keine Übernahme in den aktiven Deploy.

**How to apply:** Die aktive Live-Registrierung beziehungsweise den authentifizierten Versandstatus prüfen. Bei fehlender Live-Konfiguration die Publishing-Einstellungen und eine erforderliche erneute Veröffentlichung benennen, ohne eigenständig Produktionswerte zu ändern oder zu veröffentlichen. Provider-Annahme und bestätigte Inbox-Zustellung getrennt ausweisen.

Transaktionale Mailgrafiken dürfen nicht vom privaten App-Ursprung als externe Bilder abhängen.

**Why:** Der veröffentlichte App-Ursprung ist zugangsgeschützt; Mailclients können dessen Logo nicht verlässlich anonym laden. Eingebettete CID-Grafiken vermeiden diese Abhängigkeit ohne Tracking oder öffentliche Freigabe zusätzlicher App-Inhalte.

**How to apply:** Für künftige Mailvorlagen kleine eingebettete Markenassets verwenden und lesbares Textbranding für Clients erhalten, die Bilder blockieren. Browser-Vorschauen sind kein Nachweis für Gmail-, Outlook- oder Apple-Mail-spezifische Darstellung.
