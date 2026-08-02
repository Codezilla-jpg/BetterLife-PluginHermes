# Changelog

## 0.1.0 — 2026-08-02

### Added

- Codex account-window and Grok/xAI response-rate-limit status with exact local reset times.
- Active-session context percentage, token budget and category details.
- Local clock refreshed every minute.
- `session.actions` contribution for a native, profile-routed workspace change.
- Event-driven refresh plus bounded 60-second polling fallback.
- Full cleanup of timers, subscriptions, event listeners and contributions on unload.
- Isolated VM smoke test and deterministic ZIP/SHA-256 packaging.

### Safety

- No direct provider calls or credential access from the plugin.
- Grok API response limits are never mislabeled as SuperGrok account quotas.
- Busy live sessions reject workspace changes.
