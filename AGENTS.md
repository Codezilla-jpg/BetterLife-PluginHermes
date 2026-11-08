# AGENTS.md — BetterLife-PluginHermes

Hermes-Plugin: Desktop-Teil (JS) + Dashboard-API (Python).

Gate: `npm run check && npm test`

## Gates
- Vor Commit/Release: `npm run verify` — Syntaxcheck, Smoke-/Backend-Tests, deterministisches ZIP + SHA-256 unter `dist/`. Muss grün sein.

## Regeln
- Version in `package.json`, `plugin.yaml`, `release.json` und ZIP-Namen in `verify` gemeinsam anheben; `CHANGELOG.md` pflegen.
- Release (nur auf Auftrag) = Commit, Push, Tag und GitHub-Release mit ZIP + SHA; vorher Commit, Remote, Tag-Ziel abgleichen.
- Hermes-Core nicht patchen; Erweiterungen als Plugin.
- Sichtbare Strings deutsch, Identifier englisch. Commit-Präfix `pi:`; nicht automatisch pushen.
