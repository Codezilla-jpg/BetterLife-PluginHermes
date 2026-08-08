# BetterLife – Hermes Plugin

BetterLife ergänzt Hermes Desktop um eine Cronjob-Verwaltung in der Session-Bar, einen Gateway-Neustart und vier kompakte Anzeigen in der Statusleiste.

## Was BetterLife bisher macht

- **Cronjobs:** Eintrag in der Session-Bar öffnet die native Hermes-Verwaltung mit Übersicht, Erstellen, Bearbeiten, Pausieren, Starten und Löschen.
- **Codex:** Account-Limits.
- **Grok:** Primärwert entspricht **Grok Build** in der offiziellen Oberfläche; das separate Monatskontingent bleibt im Detail sichtbar.
- **Ctx:** Kontextauslastung der aktiven Session.
- **Uhrzeit:** lokale Zeit im 24-Stunden-Format ohne AM/PM.
- **Restart-Rad:** startet das verbundene Hermes-Gateway direkt links neben der Client-Version neu.

## Architektur

Das Plugin besteht aus zwei kleinen Teilen:

1. `plugin.js` rendert die Statusleisten-Anzeigen mit der offiziellen Desktop-Plugin-SDK.
2. `backend/dashboard/plugin_api.py` liest die Provider-Limits serverseitig über bereits vorhandene Hermes-OAuth-Anmeldungen.

Die technische Plugin-ID bleibt aus Kompatibilitätsgründen `statusline-workspaces`.

## Datenquellen

- Codex: `agent.account_usage.fetch_account_usage("openai-codex")`
- Grok: `https://cli-chat-proxy.grok.com/v1/billing`
- Kontext: `session.context_breakdown`

## Installation

### Hermes-Host

```bash
mkdir -p ~/.hermes/plugins/statusline-workspaces/dashboard
cp {plugin.yaml,__init__.py} ~/.hermes/plugins/statusline-workspaces/
cp backend/dashboard/{manifest.json,plugin_api.py} ~/.hermes/plugins/statusline-workspaces/dashboard/
hermes plugins enable statusline-workspaces
```

Danach den Hermes-Gateway-/Dashboard-Prozess neu starten.

### Hermes Desktop

```bash
mkdir -p ~/.hermes/desktop-plugins/statusline-workspaces
cp plugin.js ~/.hermes/desktop-plugins/statusline-workspaces/plugin.js
```

Hermes Desktop lädt Dateiänderungen automatisch; andernfalls die App einmal neu starten.

## Bedienung

- **Cronjobs** in der Session-Bar öffnet die vollständige native Cron-Verwaltung.
- Hover über **Codex** oder **Grok** zeigt Zeitfenster und Reset-Zeiten.
- Hover über **Ctx** zeigt Tokenbudget und Kontextkategorien.
- Rechtsklick auf die Statusleiste blendet einzelne Anzeigen ein oder aus.
- Das Restart-Rad links neben der Client-Version startet das verbundene Gateway neu und dreht sich während des Neustarts.

## Entwicklung

```bash
npm run verify
```

Der Befehl prüft Frontend und Backend und erzeugt ein deterministisches ZIP samt SHA-256-Datei unter `dist/`.
