# BetterLife – Hermes Plugin

BetterLife bündelt Provider-Limits, Composer-Profil/Workspace-Pills, lokale Uhrzeit und Neustart-Aktionen in einem Hermes-Desktop-Plugin.

## Funktionen

- **Limits-Pane:** Restkontingent-Ringe für Nous Research, OpenAI Codex und xAI Grok.
- **Kontodetails:** Provider, Account, Tarif und nächste Reset-Zeit.
- **Composer-Kontext:** Profil- und Workspace-Pills über der Chateingabe, analog zur Modellwahl. Im leeren Chat wählbar, danach fest auf dem aktuellen Ort.
- **Uhrzeit:** lokale Zeit im 24-Stunden-Format.
- **Neustarts:** Client, Messaging-Gateway oder verbundene Hermes-Instanz.
- **Hover-Namen:** Die drei Restart-Räder erweitern sich zu **Client**, **Gateway** oder **Hermes**.

Die technische Plugin-ID bleibt aus Kompatibilitätsgründen `statusline-workspaces`.
Das eigenständige `provider-limits`-Plugin wird nach der Installation nicht mehr benötigt.

## Architektur

- `plugin.js` registriert die Limits-Pane, Composer-Profil/Workspace-Pills sowie Uhr und Restart-Aktionen in der Statusleiste.
- `backend/dashboard/plugin_api.py` liest die Provider-Kontingente serverseitig und führt feste Neustart-Aktionen aus.

## Datenquellen

- Nous: Hermes-Nous-Portal-Account.
- Codex: Codex-Usage-Endpunkt mit Fallback auf `agent.account_usage`.
- Grok: `https://cli-chat-proxy.grok.com/v1/billing`.

Credentials bleiben im Hermes-Backend und werden nie an den Renderer übertragen.

## Installation

### Hermes-Host

```bash
mkdir -p ~/.hermes/plugins/statusline-workspaces/dashboard
cp {plugin.yaml,__init__.py} ~/.hermes/plugins/statusline-workspaces/
cp backend/dashboard/{manifest.json,plugin_api.py,restart_helper.py} ~/.hermes/plugins/statusline-workspaces/dashboard/
hermes plugins enable statusline-workspaces
```

Danach Gateway beziehungsweise Dashboard neu starten.

### Hermes Desktop

```bash
mkdir -p ~/.hermes/desktop-plugins/statusline-workspaces
cp plugin.js ~/.hermes/desktop-plugins/statusline-workspaces/plugin.js
```

Hermes Desktop lädt Dateiänderungen automatisch. Falls das Plugin bereits deaktiviert war, muss es in **Settings → Plugins** wieder aktiviert werden.

## Entwicklung

```bash
npm run verify
```

Der Befehl prüft Frontend und Backend und erzeugt ein deterministisches ZIP samt SHA-256-Datei unter `dist/`.
