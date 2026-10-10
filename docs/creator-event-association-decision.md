# Creator-Eventzuordnung – Betreiberentscheidung

Status: Modellentscheidung bestätigt; Umsetzung in Entwicklung ausdrücklich freigegeben
und umgesetzt. Keine Produktionsmigrations- oder Veröffentlichungsfreigabe.

## Modellentscheidung

Bestehende eigene Creator-Galerien erhalten eine lose Zuordnung zu einem offiziellen
VCO-Event. Mehrere Creator-Galerien können derselben offiziellen Veranstaltung zugeordnet
werden und auf deren Seite erscheinen. Jede Galerie bleibt die bestehende eigenständige
Event-/Galerieeinheit. Ein neues, getrenntes Veranstaltungs- und Galeriemodell ist nicht
beauftragt.

**Begründung:** Die gewünschte gemeinsame Auffindbarkeit lässt sich mit einer Zuordnung
erreichen, ohne Eigentum, Veröffentlichungszustand oder Identität bestehender Galerien
in ein neues Modell zu übertragen.

## Bestätigte Semantik

| Bereich | Entscheidung |
|---|---|
| Eigentum | Creator behalten Eigentum und Verwaltung ihrer eigenen Galerie. Die Zuordnung überträgt keine Rechte am offiziellen Event oder an fremden Galerien. |
| Veröffentlichung | Creator veröffentlichen ihre Galerie unabhängig. Bestehende Safety-, Sichtbarkeits- und Sperrregeln bleiben verbindlich; die Zuordnung ist keine Freigabe und kein Weg zu offizieller Sichtbarkeit. |
| Quoten | Jede eigene Galerie zählt weiterhin zum Limit ihres Creators. Regulär gelten 5 Galerien, 1.000 Fotos und 500 MB; eine Zuordnung erhöht keine Quote. Bestehende begrenzte Ausnahmen werden durch die Zuordnung nicht verändert. |
| Likes | Likes bleiben pro Galerie beziehungsweise Foto getrennt. Keine Übertragung oder Zusammenrechnung auf das offizielle Event. |
| Favoriten | Favoriten verweisen weiterhin auf die konkrete Galerie beziehungsweise das konkrete Foto. Eine Zuordnung erzeugt keine zusätzlichen Favoriten und ändert bestehende Verweise nicht. |
| Offizielle Priorität | Offizielle Inhalte stehen zuerst. Zugeordnete Creator-Galerien werden klar als Community-Inhalte gekennzeichnet, nicht als offizielle VCO-Inhalte. |
| Bestand und Migration | Bestehende IDs, Links und Medien bleiben erhalten. Keine automatische Zuordnung alter Galerien, keine Zusammenlegung und keine Übertragung bestehender Likes/Favoriten. |
| Löschung des offiziellen Events | Nur die Zuordnung entfällt. Eigenständige Creator-Galerien und deren Medien werden dadurch nicht gelöscht. |

## Freigabe und Grenzen

Der Betreiber hat ausdrücklich zugestimmt, eine **separate Umsetzungsaufgabe
vorzuschlagen**. Diese Entscheidung beauftragt noch keine Implementierung,
Veröffentlichung oder Produktionsmigration.

Die ursprüngliche Entscheidungsaufgabe veränderte ausschließlich Dokumentation.
Der Betreiber hat anschließend die Umsetzung ausdrücklich mit
„Ja, in Entwicklung umsetzen – keine Produktionsänderungen“ freigegeben.
Die Freigabe gilt nur für Entwicklung; der kontrollierte Ablauf ist in
`docs/creator-event-association-rollout.md` beschrieben.

Eine spätere Umsetzung soll die bestätigte Semantik durchgängig in Creator-Verwaltung,
offizieller Eventseite, Zugriffsschutz und Tests abbilden. Die konkrete additive
Schemaänderung und ihre kontrollierte Anwendung sind erst dort auszuarbeiten;
eine Produktionsmigration erfordert weiterhin ausdrückliche Freigabe.

Die Bedienung der Zuordnung (Auswahl, Änderung und Entfernung), zulässige Ziel-Events
und der Umgang mit ausgeblendeten oder nicht öffentlichen Zielen sind in der separaten
Umsetzung zu konkretisieren. Daraus dürfen weder neue Eigentumsrechte noch eine
Umgehung bestehender Sichtbarkeits- oder Safetyregeln entstehen.

## Entscheidungsgrundlage

- `shared/schema.ts`: bestehende Event-/Galerieeinheit, Eigentum, Medien und persönliche Verweise.
- `server/storage.ts`: bestehende Eigentums-, Speicher- und Galerieoperationen.
- `server/beta-policy.ts`: bestehende Veröffentlichungsschranken und Creatorquoten.
- `server/community.ts`: Likes, Favoriten und persönliche Listen.
- `client/src/pages/creator/dashboard.tsx`: Verwaltung eigener Galerien.
- `docs/community-studio-report.md`: bisher dokumentierte Modellgrenze.
