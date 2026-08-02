# Hermes Statusline

Persönliches Hermes-Desktop-Plugin mit drei kompakten Statusleistenanzeigen:

- **Account usage** — Nous-Plan und verfügbares Guthaben über `usage.bars`.
- **Context usage** — Kontextverbrauch der aktiven Sitzung über `session.context_breakdown`.
- **Local clock** — lokale Uhrzeit, minütlich aktualisiert.

## Warum 0.2.0?

Version 0.1.0 hing von experimentellen Core-Erweiterungen ab (`SESSION_ACTIONS_AREA`, Workspace-Hostmethoden und `usage.providers`). Diese Erweiterungen sind nicht Teil der aktuellen offiziellen Hermes-Desktop-SDK. Version 0.2.0 verwendet ausschließlich APIs aus Hermes Agent 0.19.1 und lädt deshalb ohne gepatchten Desktop-Core.

Die Workspace-Umschaltung wurde bewusst entfernt. Arbeitsbereiche werden weiterhin über die nativen Hermes-Funktionen verwaltet.

## Installation

```text
$HERMES_HOME/desktop-plugins/statusline-workspaces/plugin.js
```

Der Ordnername muss der Plugin-ID `statusline-workspaces` entsprechen. Hermes Desktop lädt Änderungen automatisch; alternativ über die Command Palette **Reload desktop plugins** ausführen.

## Bedienung

- **Account usage** zeigt Plan und verfügbares Nous-Guthaben; Hover zeigt Verbrauch und Erneuerung.
- **Ctx** zeigt den aktiven Kontextverbrauch; Hover zeigt Tokenbudget und Kategorien.
- Rechtsklick auf die Statusleiste blendet einzelne Anzeigen ein oder aus.

## Datenschutz

- Keine direkte Provider-Abfrage aus dem Renderer.
- Kein Zugriff auf Tokens, API-Keys oder Account-IDs.
- Nur lesende Gateway-RPCs.

## Entwicklung

```bash
npm run verify
```

Prüft Syntax, SDK-Mock, Lifecycle-Cleanup, deterministische Paketierung und SHA-256-Sidecar.
