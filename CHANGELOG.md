# Changelog

## 0.2.0 — 2026-08-03

### Fixed

- Plugin lädt mit der offiziellen Hermes-Desktop-SDK aus Hermes Agent 0.19.1.
- Nicht veröffentlichte Imports und Hostmethoden entfernt.
- `usage.providers` durch das vorhandene read-only RPC `usage.bars` ersetzt.
- Workspace-Aktion entfernt, weil ihre SDK-Schnittstelle nicht Teil des offiziellen Builds ist.
- Smoke-Test prüft ausdrücklich, dass keine experimentellen APIs zurückkehren.

### Kept

- Nous-Kontostatus, aktiver Kontextverbrauch und lokale Uhr.
- React-Query-Polling mit automatischem Cleanup durch den Komponenten-Lifecycle.

## 0.1.0 — 2026-08-02

- Erste experimentelle Fassung mit Provider-Limits, Kontext, Uhr und Workspace-Aktion.
