# Hermes Statusline & Workspaces

Hermes-Desktop-Plugin für kompakte Provider- und Kontextdaten in der Statusleiste sowie einen sicheren Workspace-Wechsel im Drei-Punkte-Menü gespeicherter Sessions.

## Funktionen

- **Codex-/Grok-Limits:** zeigt die höchste Auslastung der verfügbaren Account- oder API-Limitfenster. Das Menü nennt alle bekannten Fenster, Restkontingente und lokale Reset-Zeitpunkte.
- **Kontext:** zeigt die Auslastung der aktiven Session und im Menü Tokenbudget sowie die größten Kontextkategorien.
- **Lokale Uhr:** minutenaktuelle Uhrzeit mit vollständigem Datum im Tooltip.
- **Workspace ändern …:** öffnet den nativen lokalen oder Remote-Verzeichnis-Picker und persistiert das neue CWD für die ausgewählte gespeicherte Session.
- Alle drei Statusleisten-Einträge lassen sich über das Kontextmenü der Statusleiste ausblenden.

## Daten- und Sicherheitsgrenzen

- Das Plugin ruft Provider niemals direkt auf und liest keine Credentials. Es verwendet ausschließlich die Gateway-RPCs `usage.providers` und `session.context_breakdown`.
- Codex-Accountdaten stammen aus Hermes' bestehender Account-Usage-Integration.
- Grok zeigt nur belastbare Telemetrie aus xAI-Antwortheadern. Ein SuperGrok-/Consumer-Abo-Kontingent wird **nicht** aus API-Rate-Limits abgeleitet. Solange noch kein xAI-Response-Limit beobachtet wurde, zeigt das Menü „no limit telemetry yet“.
- Provider- und Kontextdaten werden alle 60 Sekunden sowie nach relevanten Gateway-Ereignissen aktualisiert.
- Ein Workspace-Wechsel wird vom Backend abgelehnt, wenn die Session gerade arbeitet; ein laufender Turn wechselt sein CWD dadurch nie unbemerkt.

## Voraussetzungen

Benötigt eine Hermes-Desktop-Version mit:

- `SESSION_ACTIONS_AREA` (`session.actions`)
- `host.selectWorkspaceDirectory(...)`
- `host.setSessionWorkspace(...)`
- Gateway-RPC `session.workspace.set`
- Gateway-RPC `usage.providers`

Ältere Desktop-/Gateway-Versionen laden das Plugin nicht vollständig; die Statusitems zeigen dann einen klaren „unavailable“-Zustand und die Workspace-Aktion darf nicht angeboten werden.

## Installation

Entpacke die Runtime-Dateien nach:

```text
$HERMES_HOME/desktop-plugins/statusline-workspaces/
```

Mindestens `plugin.js` und `release.json` müssen dort liegen. Danach in Hermes Desktop **⌘K → Reload desktop plugins** ausführen oder die App neu starten.

## Entwicklung und Prüfung

Voraussetzung: Node.js `>=22 <25` und Python 3.

```bash
npm run check
npm test
npm run package
npm run verify
```

Der Smoke-Test lädt `plugin.js` in einem isolierten Node-VM-Kontext und verifiziert Formatter, Polling, Event-Reaktionen, Workspace-Mutation und vollständiges Cleanup beim Deaktivieren.

## Paket

`npm run package` erzeugt deterministisch:

- `dist/statusline-workspaces-hermes-desktop-v0.1.0.zip`
- `dist/statusline-workspaces-hermes-desktop-v0.1.0.zip.sha256`

Das Archiv enthält nur Runtime-Dateien und Dokumentation, keine Tests, Build-Skripte, Secrets oder lokalen absoluten Pfade.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
