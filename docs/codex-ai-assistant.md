# KI-Assistent mit Codex

Der Prototyp öffnet Codex direkt im lokalen Layerling-Editor. Er benötigt den Codex CLI auf demselben Rechner, einen laufenden Layerling-Entwicklungsserver und einen geöffneten Editor-Tab. Der statische Layerling-Build enthält die lokalen Serverrouten nicht.

## Installation und Verbindung

Voraussetzungen: macOS, Windows oder Linux mit Node.js `>=22.18`, [Codex CLI](https://developers.openai.com/codex/cli) und eine lokale Layerling-Arbeitskopie. Im Layerling-Projekt `npm install` und `npm run dev` starten, dann einen Editor öffnen. Die vorhandene Codex-Anmeldung wird wiederverwendet.

1. Den Sternknopf unten rechts im Editor öffnen.
2. Layerling prüft die Codex-Verbindung, Modellliste und Nutzungslimits.
3. Ist Codex noch nicht mit ChatGPT verbunden, „Mit ChatGPT verbinden“ wählen. Codex öffnet seinen offiziellen ChatGPT-Anmeldeablauf. Ein API-Schlüssel und eine manuelle Tokenübertragung sind nicht erforderlich.
4. Nach der Anmeldung den Assistenten erneut öffnen oder den Verbindungsstatus aktualisieren, indem das Fenster geschlossen und wieder geöffnet wird.

Der Assistent läuft nur auf `localhost` und ist im Produktionsmodus abgeschaltet. Bei einer älteren Codex-Version hilft ein Update des installierten Codex CLI. Wenn Codex nicht im `PATH` liegt, kann `CODEX_EXECUTABLE` auf die lokale ausführbare Datei zeigen.

## Verwenden

Eine Nachricht beschreibt eine Konstruktion oder Änderung. Der Assistent greift über Layerlings vorhandene MCP-Werkzeuge auf den geöffneten Editor zu. Er kann die Szene lesen, CAD-Formen anlegen und vorhandene Objekte bearbeiten. Weitere Nachrichten setzen dasselbe Gespräch fort; „Neues Gespräch“ beginnt einen anderen Thread. Während der Bearbeitung zeigt die Oberfläche den Status und bietet eine Abbrechen-Schaltfläche.

Das Modellmenü bezieht die verfügbaren Modelle vom Codex App Server. „Automatisch“ wählt ein Modell aus diesem Katalog und verwendet für eine einfache einzelne Grundform nach Möglichkeit geringe, sonst die vom Modell gemeldete Standard-Denktiefe. Bei manueller Modellauswahl zeigt Layerling nur die vom Katalog gemeldeten Denktiefen an.

Die kompakte Nutzungsanzeige zeigt nur von Codex gelieferte Werte. Die Detailansicht nennt die tatsächliche Länge des jeweiligen Fensters und dessen Rücksetzzeit. Primär-/Sekundärfenster werden nicht als 5-Stunden- oder Wochenkontingent etikettiert, wenn Codex diese Zuordnung nicht ausweist. Falls Codex keine Limits liefert, blendet Layerling die Anzeige aus. ChatGPT-Nutzung lässt sich in ChatGPT unter „Nutzung verwalten“ prüfen.

### Beispiele

- „Erstelle einen Würfel mit 50 mm Kantenlänge.“
- „Lege eine Grundplatte mit 100 × 60 × 5 mm an und platziere vier Zylinder mit 10 mm Durchmesser und 15 mm Höhe darauf, jeweils 10 mm von den Außenkanten entfernt.“
- „Wähle die vorhandene Bohrung aus und vergrößere sie auf 8 mm Durchmesser.“
- „Erstelle eine Halterung für ein Rohr mit 25 mm Außendurchmesser auf einer 80 × 50 × 5 mm großen Grundplatte. Setze zwei Befestigungsbohrungen mit 5 mm Durchmesser und 60 mm Abstand.“
- „Verbreitere die zuletzt angelegte Grundplatte auf 80 mm und lasse die übrigen Maße und die Position der Bauteile unverändert.“

Gib bei funktionalen Bauteilen Maße, Passungen und Befestigungspunkte an. Der Assistent fragt nach, wenn eine wichtige Angabe fehlt. Prüfe die Konstruktion im Editor; Änderungen sind Teil des normalen Layerling-Verlaufs und können dort rückgängig gemacht werden.

## Architektur für Entwickler

`CodexAssistant.tsx` liefert die lokale Chatoberfläche. `/api/codex-assistant` startet den offiziellen `codex app-server` als lokalen Prozess und beschränkt Anfragen auf Loopback im Entwicklungsmodus. `codexAssistantServer.ts` spricht dessen dokumentiertes JSON-RPC/JSONL-Protokoll über stdio an: `account/read`, `account/login/start`, `model/list`, `account/rateLimits/read`, `thread/start`/`thread/resume`, `turn/start` und `turn/interrupt`. Zugangsdaten werden von Codex verwaltet; Layerling liest oder speichert keine Tokens und Passwörter.

Der Codex-Prozess erhält den bereits im Repository vorhandenen MCP-Server `scripts/layerling-mcp-server.mjs` als Werkzeug. Dieser kommuniziert mit `/api/layerling-mcp`, die Befehle an den geöffneten Editor verteilt. CAD-Parameter und Änderungen laufen damit durch dieselben Prüfungen und Commit-/Undo-Funktionen wie die bestehende MCP-Integration. Es wird keine interne Editor-API nachgebaut.

Codex bekommt für den Thread eine schreibgeschützte Dateisandbox. Die notwendigen CAD-Aufrufe erfolgen über MCP. Der Gesprächsverlauf liegt in Codex; die Browseroberfläche merkt sich lediglich Thread-ID und lokal dargestellte Nachrichten. Es werden keine Szene oder CAD-Dateien vorsorglich an den Server übertragen; Codex liest Szeneinformationen bei Bedarf über MCP. Die Verbindung zum Modellanbieter verarbeitet Anfragen gemäß dem ChatGPT-Tarif des verbundenen Codex-Kontos.

Die App-Server-Oberfläche ist offiziell dokumentiert, entwickelt sich aber weiter. Layerling sollte Methodenfehler verständlich anzeigen und die unterstützten Codex-Versionen regelmäßig prüfen. Der Prototyp unterstützt lokale Entwicklungsinstallationen; ein statisch gehostetes Produkt bräuchte einen separaten signierten lokalen Hostprozess. Es gibt in diesem Prototyp weder ein Layerling-Plugin-System noch eine neue OAuth-/Token-Verwaltung.

## Upstream-Updates

Die Erweiterung bleibt auf eine neue Komponente, eine API-Route und den bestehenden Editor-Einstieg begrenzt. Beim Übernehmen neuer Upstream-Versionen zuerst den Feature-Branch gegen den gewünschten Upstream-Stand rebasen oder mergen, Konflikte insbesondere in `LayerlingEditor.tsx`, `globals.css` und den Nachrichtenkatalogen auflösen und danach Typprüfung sowie MCP-Tests ausführen. Es werden keine Änderungen an `upstream` veröffentlicht.

## Bekannte Grenzen

- Der Prototyp wurde auf macOS mit Codex CLI `0.163.0` und einem separaten lokalen Editor getestet: ChatGPT-Konto, sieben Modelle und Kontingentdaten wurden über App Server gelesen; eine natürliche Anweisung erstellte einen 10-mm-Würfel und eine Folgeanweisung änderte ihn auf 12 mm. Ein weiterer Durchlauf über die Layerling-Chat-API änderte ihn auf 14 mm. Die Szene bestätigte die Maße, ein Ansichtsbild zeigte den Körper. Die offizielle Browser-Anmeldung wurde nicht erneut durchlaufen, weil die lokale Codex-Anmeldung bereits aktiv war.
- Die Oberfläche ist derzeit auf Englisch und Deutsch übersetzt; andere Sprachen fallen auf Englisch zurück.
- Nutzungslimits erscheinen nur, wenn Codex sie über `account/rateLimits/read` bereitstellt.
- Der Chat lässt sich in der Größe verändern, aber noch nicht frei verschieben oder andocken.
- Codex App Server ist ein sich weiterentwickelndes Protokoll. Kompatibilität und Anmeldestatus hängen von der lokal installierten Codex-Version und dem Konto ab.
