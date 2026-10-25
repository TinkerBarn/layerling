# KI-Assistent mit Codex

Der Prototyp öffnet Codex direkt im lokalen Layerling-Editor. Er benötigt Node.js `>=22.18`, das Codex CLI auf demselben Rechner, einen laufenden Layerling-Entwicklungsserver und mindestens einen geöffneten Editor-Tab. Der statische Layerling-Build enthält die lokalen Serverrouten nicht. Layerlings allgemeine Plattformunterstützung ist keine Zusage, dass diese lokale Codex-Erweiterung auf derselben Plattform getestet wurde; siehe [Kompatibilitäts- und Prüfbericht](codex-ai-assistant-audit.md).

## Installation und Verbindung

Wähle unten die Anleitung für dein Betriebssystem. Du brauchst eine Layerling-Arbeitskopie, die diese Integration enthält. Wenn du Layerling bereits für die Entwicklung verwendest, nutze diesen Projektordner weiter und überspringe den Klon-Schritt.

### Windows (PowerShell)

1. Installiere [Node.js für Windows](https://nodejs.org/en/download) in Version `22.18` oder neuer. Öffne danach ein **neues** PowerShell-Fenster und prüfe die Installation:

   ```powershell
   node --version
   npm --version
   ```

2. Installiere [Git für Windows](https://git-scm.com/download/win), falls Git noch fehlt. Wenn du noch keine Layerling-Arbeitskopie hast, klone das Repository und wechsle in den Ordner:

   ```powershell
   git clone https://github.com/henmedia/layerling.git
   Set-Location layerling
   ```

3. Installiere Codex CLI über npm:

   ```powershell
   npm install -g @openai/codex@latest
   codex --version
   ```

   Die aktuelle Installations- und Anmeldeanleitung steht in der [offiziellen Codex-CLI-Dokumentation](https://developers.openai.com/codex/cli).

4. Starte Codex einmal im Layerling-Projektordner und melde dich im angezeigten Ablauf mit **ChatGPT anmelden** an. Beende Codex anschließend mit `Ctrl+C`:

   ```powershell
   codex
   ```

5. Installiere Layerlings Projektabhängigkeiten und starte den Entwicklungsserver:

   ```powershell
   npm install
   npm run dev -- --port 3001
   ```

   Lass dieses PowerShell-Fenster geöffnet. `Ctrl+C` beendet den Server.

6. Öffne [http://localhost:3001](http://localhost:3001), öffne oder erstelle einen Editor-Entwurf und wähle **Verwalten → Zahnrad → Arbeitsbereich-Einstellungen → Darstellung → ChatGPT Chat verwenden**.

7. Öffne das Assistant-Symbol. Der Status sollte **ChatGPT verbunden** anzeigen. Falls Layerling eine Anmeldung anbietet, folge dem Dialog. Ein API-Schlüssel ist für die Anmeldung mit dem ChatGPT-Konto nicht erforderlich.

### macOS (Terminal)

1. Installiere [Node.js für macOS](https://nodejs.org/en/download) in Version `22.18` oder neuer. Prüfe danach in einem neuen Terminal-Fenster:

   ```bash
   node --version
   npm --version
   ```

2. Git ist auf vielen Macs bereits verfügbar. Falls beim Aufruf von `git` die Installation der Xcode Command Line Tools angeboten wird, bestätige sie. Wenn du noch keine Layerling-Arbeitskopie hast, klone das Repository:

   ```bash
   git clone https://github.com/henmedia/layerling.git
   cd layerling
   ```

3. Installiere Codex CLI mit dem offiziellen Installationsskript:

   ```bash
   curl -fsSL https://chatgpt.com/codex/install.sh | sh
   codex --version
   ```

   Details stehen in der [offiziellen Codex-CLI-Dokumentation](https://developers.openai.com/codex/cli).

4. Starte Codex einmal im Layerling-Projektordner und melde dich mit **ChatGPT anmelden** an. Beende Codex anschließend mit `Ctrl+C`:

   ```bash
   codex
   ```

5. Installiere Layerlings Projektabhängigkeiten und starte den Entwicklungsserver:

   ```bash
   npm install
   npm run dev -- --port 3001
   ```

   Lass dieses Terminal geöffnet. `Ctrl+C` beendet den Server.

6. Öffne [http://localhost:3001](http://localhost:3001), öffne oder erstelle einen Editor-Entwurf und wähle **Verwalten → Zahnrad → Arbeitsbereich-Einstellungen → Darstellung → ChatGPT Chat verwenden**.

7. Öffne das Assistant-Symbol. Der Status sollte **ChatGPT verbunden** anzeigen. Falls Layerling eine Anmeldung anbietet, folge dem Dialog. Ein API-Schlüssel ist für die Anmeldung mit dem ChatGPT-Konto nicht erforderlich.

Wenn `codex` nicht im `PATH` gefunden wird, setze `CODEX_EXECUTABLE` auf den Pfad zur Codex-Programmdatei und starte den Layerling-Server danach erneut. Auf Windows werden `PATHEXT` und `.cmd`/`.bat` berücksichtigt. Ein fehlender Editor oder eine nicht erreichbare Layerling-MCP-Bridge führt dazu, dass kein Assistant-Symbol angeboten und kein Codex-Prozess gestartet wird. Vor jeder CAD-Anweisung prüft der App Server außerdem, ob die benötigten Layerling-MCP-Werkzeuge geladen wurden.

**Hinweis zur Plattformprüfung:** Die Integration wurde bisher nur manuell auf macOS geprüft. Windows-Schritte sind dokumentiert, aber für diese Layerling-Integration noch nicht manuell verifiziert; siehe [Kompatibilitäts- und Prüfbericht](codex-ai-assistant-audit.md).

Der Standard-Entwicklungsserver bindet nur an `localhost`; HTML-Antworten im Entwicklungsmodus verbieten außerdem das Einbetten in Frames. Die API-Routen sind im Produktionsmodus abgeschaltet. Die Erweiterung ist eine lokale Entwicklungsfunktion, kein Bestandteil des statischen Exports oder des Docker-Deployments.

## Verwenden

Eine Nachricht beschreibt eine Konstruktion oder Änderung. Der Assistent greift über Layerlings vorhandene MCP-Werkzeuge auf den geöffneten Editor zu. Weitere Nachrichten setzen dasselbe Gespräch fort; ein neues Gespräch beginnt einen anderen Codex-Thread. Pro Browser-Tab werden Thread und angezeigte Nachrichten getrennt in `sessionStorage` gehalten. Während der Bearbeitung zeigt die Oberfläche den Status und bietet eine Abbrechen-Schaltfläche.

Das Modellmenü bezieht verfügbare Modelle und deren Denktiefen vom Codex App Server. **Automatisch** wählt ein Modell aus diesem Katalog; bei manueller Auswahl sind nur vom Katalog unterstützte Denktiefen verfügbar. Die Mikrofon-Schaltfläche bietet Diktat über die vom Browser bereitgestellte Web Speech API, wenn der Browser sie unterstützt. Sie nimmt kein Audio auf und überträgt keine Sprachaufnahme an Layerling; der Browser kann für die Spracherkennung einen externen Dienst verwenden.

Die Nutzungsanzeige zeigt Werte, die Codex liefert. Die Detailansicht nennt Fensterlänge und Rücksetzzeit, sofern diese Daten verfügbar sind. Sie etikettiert Limits nicht als 5-Stunden- oder Wochenkontingent, wenn Codex diese Zuordnung nicht ausweist. ChatGPT-Nutzung lässt sich unter [Nutzung verwalten](https://chatgpt.com/settings/usage) prüfen.

Der Abmeldeknopf ruft `account/logout` des Codex App Servers auf. Das meldet das auf diesem Rechner angemeldete Codex-Konto ab und kann daher auch andere Codex-Funktionen betreffen, die dieselbe Anmeldung verwenden.

### Beispiele

- „Erstelle einen Würfel mit 50 mm Kantenlänge.“
- „Lege eine Grundplatte mit 100 × 60 × 5 mm an und platziere vier Zylinder mit 10 mm Durchmesser und 15 mm Höhe darauf, jeweils 10 mm von den Außenkanten entfernt.“
- „Wähle die vorhandene Bohrung aus und vergrößere sie auf 8 mm Durchmesser.“
- „Erstelle eine Halterung für ein Rohr mit 25 mm Außendurchmesser auf einer 80 × 50 × 5 mm großen Grundplatte. Setze zwei Befestigungsbohrungen mit 5 mm Durchmesser und 60 mm Abstand.“
- „Verbreitere die zuletzt angelegte Grundplatte auf 80 mm und lasse die übrigen Maße und die Position der Bauteile unverändert.“

Gib bei funktionalen Bauteilen Maße, Passungen und Befestigungspunkte an. Der Assistent fragt nach, wenn eine wichtige Angabe fehlt. Prüfe die Konstruktion im Editor; Änderungen sind Teil des normalen Layerling-Verlaufs und können dort rückgängig gemacht werden.

## Architektur für Entwickler

`CodexAssistant.tsx` liefert die lokale Chatoberfläche. `/api/codex-assistant` startet den offiziellen `codex app-server` als lokalen Prozess und beschränkt Anfragen auf Loopback im Entwicklungsmodus. `codexAssistantServer.ts` spricht dessen JSON-RPC/JSONL-Protokoll über stdio an. Die Verfügbarkeit wird vor dem Prozessstart durch die lokale Layerling-MCP-Bridge und verbundene Editoren geprüft. Vor `turn/start` fragt Layerling `mcpServerStatus/list` ab und verlangt die Werkzeuge zum Auflisten von Editoren, Lesen der Szene, Anlegen und Ändern von Objekten.

Der Codex-Prozess erhält den bereits im Repository vorhandenen MCP-Server `scripts/layerling-mcp-server.mjs` als Werkzeug. Dieser kommuniziert mit `/api/layerling-mcp`, die Befehle an den geöffneten Editor verteilt. Die vorhandenen Tool-Namen und Schemas bleiben für andere MCP-Clients erhalten; im Assistant-Modus werden die lokalen Dateiexport- und Projektspeicher-Werkzeuge nicht angeboten und direkt serverseitig gesperrt. Der MCP-Server handelt eine von ihm unterstützte Protokollversion aus und bestätigt keine unbekannte Version mehr ungeprüft. CAD-Änderungen laufen durch dieselben Prüfungen und Undo-Funktionen wie die bestehende MCP-Integration.

Jede Browser-Chat-Sitzung hat getrennte Events und einen zugeordneten Codex-Thread. Serverereignisse und Freigaben werden nur an die Sitzung des betroffenen Threads gesendet. Codex bekommt für den Thread eine schreibgeschützte Dateisandbox; CAD-Aufrufe erfolgen über MCP. Zugangsdaten werden von Codex verwaltet. Layerling liest oder speichert keine Tokens und Passwörter.

## Aktualisierung und Fehlerbehebung

Der Codex App Server ist ein weiterentwickelndes Protokoll. Halte das Codex CLI aktuell. Bei „Layerling MCP tools not available“ prüfe, dass der Editor und Entwicklungsserver geöffnet sind, und starte Layerling nach Änderungen an `CODEX_EXECUTABLE` oder Codex-Konfiguration neu. Bei fehlender Anmeldung melde dich über den angebotenen Codex-Anmeldeablauf an.

Upstream-Änderungen sollten auf einem Feature-Branch übernommen werden. Nach Konfliktauflösung insbesondere in `LayerlingEditor.tsx`, `globals.css`, Komponenten und Nachrichtenkatalogen Typprüfung und MCP-Tests ausführen. Die API-Routen dieser lokalen Funktion dürfen nicht in eine öffentliche Instanz eingebunden werden, ohne ein separates Host- und Authentifizierungsdesign.

## Grenzen

- Die Erweiterung wurde bislang manuell auf macOS mit Codex CLI `0.163.0` geprüft. Windows und Linux sind für diese Codex-Erweiterung nicht manuell verifiziert.
- Layerling nennt in seiner Dokumentation keine vollständige Browser-Supportmatrix. Das Assistant-Fenster und MCP-Kommunikation wurden in dieser Prüfung nicht in einer Browsermatrix visuell getestet. Web Speech Diktat hängt von der Browser-API ab; Layerling dokumentiert Chrome und Edge für weitere Browserfunktionen wie Dateizugriff, was keine pauschale Aussage über alle Assistant-Funktionen ist.
- Die Nutzungsanzeigen sind von den Daten des App Servers abhängig.
- Layerling prüft zur Laufzeit die nötigen MCP-Werkzeuge. Es gibt keine festgeschriebene Mindestversion des Codex CLI; unbekannte oder geänderte App-Server-Antworten können daher zu einer verständlichen Laufzeitfehlermeldung führen.
- Ein statisch gehostetes Produkt bräuchte einen separaten signierten lokalen Hostprozess. Der Prototyp bietet kein eigenes Plugin-System und keine neue OAuth- oder Token-Verwaltung.
