# BetterLife – Hermes Plugin

BetterLife ergänzt Hermes Desktop um eine kompakte Statusleiste für Provider-Limits, Kontextverbrauch und Uhrzeit.

## Was BetterLife bisher macht

- **Codex-Limits:** zeigt die echten Account-Limits aus Hermes’ `openai-codex`-Usage-Client.
- **Grok-Limits:** zeigt Wochen- und Monatsverbrauch über den Grok-CLI-Billing-Endpunkt.
- **Kontextanzeige:** zeigt die aktuelle Kontextauslastung der aktiven Hermes-Session.
- **Lokale Uhr:** zeigt die Systemzeit direkt in der Statusleiste.
- **Details per Hover:** zeigt Zeitfenster, Verbrauch, Reset-Zeiten und verfügbare Planinformationen.
- **Automatische Aktualisierung:** Provider alle fünf Minuten, Kontext und Uhrzeit jede Minute.
- **Einzeln einblendbar:** Codex, Grok, Kontext und Uhr können über das Statusleisten-Menü separat ein- oder ausgeblendet werden.
- **Sichere Verarbeitung:** OAuth-Tokens und Account-Identitäten bleiben im Backend; der Desktop erhält nur Verbrauchswerte und Reset-Zeitpunkte.
- **Ehrliche Fehleranzeige:** nicht verfügbare Provider erscheinen mit `—`, statt fremde oder erfundene Werte anzuzeigen.

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

- Hover über **Codex** oder **Grok** zeigt Zeitfenster und Reset-Zeiten.
- Hover über **Ctx** zeigt Tokenbudget und Kontextkategorien.
- Rechtsklick auf die Statusleiste blendet einzelne Anzeigen ein oder aus.

## Entwicklung

```bash
npm run verify
```

Der Befehl prüft Frontend und Backend und erzeugt ein deterministisches ZIP samt SHA-256-Datei unter `dist/`.
