# Changelog

## 0.3.0 — 2026-08-03

### Added

- Separate Statusleisten-Chips für echte Codex- und Grok-Account-Quotas.
- Kleines Hermes-Dashboard-Backend mit zweiminütigem Cache.
- Codex-Limits über Hermes’ vorhandenen `openai-codex`-Usage-Client.
- Grok-Wochen- und Monatsquota über den Grok-CLI-Billing-Endpunkt.
- Parser-Tests für wöchentliche und monatliche Grok-Billing-Antworten.

### Changed

- Pluginname auf **Hermes Pulsebar** aktualisiert.
- Nous-Billinganzeige vollständig entfernt.
- Fehlende Providerdaten werden ehrlich als nicht verfügbar dargestellt.

## 0.2.0 — 2026-08-03

### Fixed

- Plugin lädt mit der offiziellen Hermes-Desktop-SDK aus Hermes Agent 0.19.1.
- Nicht veröffentlichte Imports und Hostmethoden entfernt.
- Workspace-Aktion entfernt, weil ihre SDK-Schnittstelle nicht Teil des offiziellen Builds ist.
- Smoke-Test prüft ausdrücklich, dass keine experimentellen APIs zurückkehren.

### Kept

- Aktiver Kontextverbrauch und lokale Uhr.
- React-Query-Polling mit automatischem Cleanup durch den Komponenten-Lifecycle.

## 0.1.0 — 2026-08-02

- Erste experimentelle Fassung mit Provider-Limits, Kontext, Uhr und Workspace-Aktion.
