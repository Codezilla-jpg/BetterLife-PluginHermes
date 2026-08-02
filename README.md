# Hermes Pulsebar

Kompakte Hermes-Desktop-Statusleiste für echte Provider-Quotas, Kontext und Uhrzeit.

## Anzeigen

- **Codex** — Account-Limits aus Hermes’ vorhandenem `openai-codex`-Usage-Client.
- **Grok** — SuperGrok-Quota über den Grok-CLI-Billing-Endpunkt.
- **Ctx** — Kontextverbrauch der aktiven Hermes-Session.
- **Uhrzeit** — lokale Systemzeit.

Die frühere Nous-Anzeige wurde entfernt. `usage.bars` beschreibt das Hermes-/Nous-Billing und ist keine Codex- oder Grok-Quota.

## Architektur

Das Paket besteht aus zwei kleinen Teilen:

1. `plugin.js` rendert die Statusleisten-Chips mit der offiziellen Desktop-Plugin-SDK.
2. `backend/dashboard/plugin_api.py` liest Provider-Quotas serverseitig über bereits vorhandene Hermes-OAuth-Anmeldungen.

Tokens und Account-Identitäten werden nie an den Desktop-Renderer ausgegeben. Der Backend-Endpunkt liefert nur Prozentwerte, Zeitfenster und Reset-Zeitpunkte.

## Datenquellen

- Codex: `agent.account_usage.fetch_account_usage("openai-codex")`.
- Grok: `https://cli-chat-proxy.grok.com/v1/billing` mit `xai-oauth`.
- Kontext: `session.context_breakdown`.

Falls ein Provider nicht angemeldet oder sein Billing-Endpunkt nicht erreichbar ist, zeigt Pulsebar ehrlich `Codex —` beziehungsweise `Grok —` statt Nous-Werte falsch umzubenennen.

## Installation

### Hermes-Host

```bash
mkdir -p ~/.hermes/plugins/statusline-workspaces/dashboard
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

- Hover über **Codex** oder **Grok** zeigt einzelne Zeitfenster und Reset-Zeiten.
- Hover über **Ctx** zeigt Tokenbudget und Kategorien.
- Rechtsklick auf die Statusleiste blendet einzelne Anzeigen ein oder aus.

## Entwicklung

```bash
npm run verify
```

Erzeugt zusätzlich ein deterministisches ZIP samt SHA-256-Datei unter `dist/`.
