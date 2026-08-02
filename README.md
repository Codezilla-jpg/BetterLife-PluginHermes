# Hermes Statusline & Workspaces

Scaffold für ein eigenständiges Hermes-Desktop-Disk-Plugin. Version: **0.1.0**.

## Stand von Task 1

Das Plugin registriert ausschließlich vier statische Platzhalterbeiträge:

- `provider-limits` in `statusBar.right`
- `context-usage` in `statusBar.right`
- `local-clock` in `statusBar.right`
- `change-workspace` in `session.actions`

Es führt noch **keine Providerabfrage** aus, berechnet noch keine echte Kontextauslastung, startet keinen Uhr-Timer und verändert keinen Workspace.

## SDK-Voraussetzung

Dieses Repository ist vorerst nur ein verifiziertes Scaffold und noch keine Behauptung eines installierbaren, funktionsfähigen Releases. Für die geplante Funktionalität braucht Hermes Desktop später eine öffentlich unterstützte SDK-Capability für `session.actions` sowie Workspace-Ermittlung und -Mutation. Bis diese Schnittstellen feststehen und gegen einen realen Desktop-Loader geprüft sind, bleiben die Beiträge absichtlich inert.

## Entwicklung

Voraussetzung: Node.js `>=22 <25` und Python 3.

```bash
npm run check
npm test
npm run package
npm run verify
```

Der Smoke-Test lädt `plugin.js` in einem isolierten Node-VM-Kontext. Nur `@hermes/plugin-sdk`, `react` und `react/jsx-runtime` wären als spätere Imports zulässig; andere Imports weist der Loader zurück.

## Paket

`npm run package` erzeugt deterministisch:

- `dist/statusline-workspaces-hermes-desktop-v0.1.0.zip`
- `dist/statusline-workspaces-hermes-desktop-v0.1.0.zip.sha256`

Das Archiv enthält nur Runtime-Dateien und Dokumentation, keine Tests, Build-Skripte, Secrets oder lokalen absoluten Pfade. Das ZIP ist ein Entwicklungsartefakt des Scaffolds und derzeit keine Installierbarkeitszusage.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
