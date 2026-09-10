# BetterLife – Hermes Plugin

BetterLife bündelt Provider-Limits, lokale Uhrzeit und Neustart-Aktionen in einem Hermes-Desktop-Plugin.

## Funktionen

- **Limits-Pane:** Restkontingent-Ringe für Nous Research, Claude-Abo, OpenAI Codex und xAI Grok.
- **Kontodetails:** Provider, Account, Tarif und nächste Reset-Zeit.
- **Uhrzeit:** lokale Zeit im 24-Stunden-Format.
- **Neustarts:** Client, Messaging-Gateway oder verbundene Hermes-Instanz.
- **Hover-Namen:** Die drei Restart-Räder erweitern sich zu **Client**, **Gateway** oder **Hermes**.

Die technische Plugin-ID bleibt aus Kompatibilitätsgründen `statusline-workspaces`.
Das eigenständige `provider-limits`-Plugin wird nach der Installation nicht mehr benötigt.

## Architektur

Unified package (Hermes ≥ 0.21):

- `desktop/plugin.js` — Limits-Pane, Uhr und Restart-Aktionen.
- `dashboard/plugin_api.py` — Provider-Kontingente und feste Neustart-Aktionen.

## Datenquellen

- Nous: Hermes-Nous-Portal-Account.
- Claude: Anthropic-OAuth-Abo (`/api/oauth/usage`).
- Codex: öffentliche Runtime-Credentials (`hermes_cli.auth_codex`) plus `/wham/usage`, Fallback `fetch_account_usage`.
- Grok: `https://cli-chat-proxy.grok.com/v1/billing`.

Credentials bleiben im Hermes-Backend und werden nie an den Renderer übertragen.

## Installation

### Hermes-Host

```bash
id=statusline-workspaces
mkdir -p ~/.hermes/plugins/$id/{dashboard,desktop}
cp {plugin.yaml,__init__.py} ~/.hermes/plugins/$id/
cp dashboard/{manifest.json,plugin_api.py,restart_helper.py} ~/.hermes/plugins/$id/dashboard/
cp desktop/plugin.js ~/.hermes/plugins/$id/desktop/plugin.js
hermes plugins enable $id
```

Danach Gateway beziehungsweise Dashboard neu starten.

### Hermes Desktop (Electron-Host)

Die Desktop-Hälfte unter `plugins/<id>/desktop/` ist opt-in. Auf den Arbeits-Macs zusätzlich nach `desktop-plugins/` kopieren (default-on):

```bash
mkdir -p ~/.hermes/desktop-plugins/statusline-workspaces
cp desktop/plugin.js ~/.hermes/desktop-plugins/statusline-workspaces/plugin.js
```

Hermes Desktop lädt Dateiänderungen automatisch. Falls das Plugin bereits deaktiviert war, muss es in **Settings → Plugins** wieder aktiviert werden.

## Entwicklung

```bash
npm run verify
```

Der Befehl prüft Frontend und Backend und erzeugt ein deterministisches ZIP samt SHA-256-Datei unter `dist/`.
