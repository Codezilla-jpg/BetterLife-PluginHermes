# Changelog

## 0.6.0 — 2026-09-07

### Added

- Profil- und Workspace-Pills über der Chateingabe, analog zur Modellwahl.
- Workspace-Auswahl öffnet einen Ordnerbrowser auf dem Hermes-Host; Dateien sind sichtbar, gewählt wird ein Ordner.
- Im leeren Chat sind beide Pills wählbar; nach der ersten Session bleiben sie fest auf dem aktuellen Profil und Workspace.

## 0.5.0 — 2026-08-25

### Added

- Das bisher eigenständige Limits-Plugin ist jetzt als native **Limits**-Pane integriert.
- Irideszente Restkontingent-Ringe für Nous, Codex und Grok mit Account, Tarif und Reset-Zeit.
- Erweiterte Codex-Modellfenster und Nous-Portal-Kontingente im BetterLife-Backend.

### Simplified

- Cronjobs-Link in der Seitenleiste entfernt.
- Alte Codex-/Grok-Nutzungs-Chips und Kontextauslastungs-Chip aus der Statusleiste entfernt.
- Provider-Limits sind in einer einzigen Pane statt in mehreren Statusleisten-Chips gebündelt.

### Fixed

- Grok-Ring und Reset-Zeit folgen gemeinsam dem Grok-Build-Fenster.
- Manueller Refresh umgeht den Backend-Cache und aktualisiert den Query-Cache direkt.
- Provider werden parallel geladen; gleichzeitige Refreshes teilen sich einen Lauf.
- Codex-Requests behalten die Account-ID, Nous ohne Kontingent wird korrekt als nicht verfügbar markiert.
- Quotenringe zeigen „übrig“ statt „links“; größere Ringe, kompaktere Typografie und schmalere Infoboxen verbessern die Proportionen.

### Unchanged

- Statusleiste zeigt die lokale 24-Stunden-Uhr plus die drei Restart-Räder für Client, Gateway und Hermes.

## 0.4.5 — 2026-08-08

### Fixed

- Gateway-Neustart verwendet jetzt den tatsächlich installierten systemweiten Dienst `hermes-gateway.service` statt des unprivilegierten Desktop-Standardpfads.
- Hermes-Neustart beendet jetzt die aktuell verbundene Remote-Backend-Instanz über einen abgekoppelten Helper; nach einer Grace-Period wird nötigenfalls zuverlässig eskaliert.
- Client-Neustart bleibt bewusst ein reiner Desktop-Reload und ist damit klar vom Hermes-Neustart getrennt.

## 0.4.4 — 2026-08-08

### Changed

- Drei getrennte Restart-Räder für **Client**, **Gateway** und **Hermes**.
- Beim Hover erweitert sich jedes Rad und zeigt seinen kurzen Zielnamen.
- Der Hermes-Neustart setzt die Desktop-verwaltete Backend-Instanz zurück und verbindet den Client anschließend neu.

## 0.4.3 — 2026-08-08

### Changed

- Die Restart-Anzeige besteht jetzt aus zwei Rädern: eines für den Desktop-Client und eines für das verbundene Backend.
- Das Client-Rad lädt die Desktop-Oberfläche neu; das Backend-Rad nutzt den nativen Gateway-Neustart.

## 0.4.2 — 2026-08-08

### Added

- Restart-Rad direkt links neben der Client-Version.
- Ein Klick startet das verbundene Hermes-Gateway neu; währenddessen dreht sich das Rad und ist gegen Doppelklicks gesperrt.

## 0.4.1 — 2026-08-08

### Fixed

- Grok zeigt jetzt denselben primären **Grok Build**-Verbrauch wie die offizielle Grok-Oberfläche.
- Das separate Monatskontingent bleibt in den Details sichtbar, bestimmt aber nicht mehr den kompakten Statusleistenwert.

## 0.4.0 — 2026-08-08

### Added

- Neuer **Cronjobs**-Eintrag in der Hermes-Session-Bar, analog zum Kanban-Plugin.
- Der Eintrag öffnet die native Cron-Verwaltung mit Übersicht, Erstellen, Bearbeiten, Pausieren, Starten und Löschen.

## 0.3.2 — 2026-08-07

### Fixed

- Das Backend-Paket enthält jetzt das von Hermes benötigte `__init__.py` mit einer gültigen No-op-Registrierung.
- Installation und Release-Archiv liefern damit ein vollständig ladbares Hermes-Plugin statt wiederholter Loader-Fehler.

## 0.3.1 — 2026-08-06

### Fixed

- Kontextanzeige verwendet eine eigene BetterLife-ID und wird nicht mehr durch die standardmäßig ausgeblendete Hermes-Kernanzeige verborgen.
- Uhrzeit wird ausdrücklich im 24-Stunden-Format ohne AM/PM dargestellt.

### Changed

- Anzeigename auf **BetterLife** aktualisiert.
- Funktionsumfang klar auf Codex, Grok, Kontext und Uhrzeit begrenzt.

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
