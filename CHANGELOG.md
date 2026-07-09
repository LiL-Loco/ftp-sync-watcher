# Changelog

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und dieses Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [2.0.0] - 2026-07-02

### ⚠️ Breaking Changes

- **Multi-Profil-Konfiguration**: `.ftpsync.json` verwendet jetzt das Top-Level-Schema `{ "profiles": [ ... ] }`. Eine bestehende flache Konfiguration wird beim Laden **automatisch** in ein einzelnes Profil mit Namen `default` migriert — bestehende Setups bleiben ohne Eingriff funktionsfähig.
- **`concurrency` entfernt**: Das Profil-Feld `concurrency` und der entsprechende Parameter in `OperationQueue` sind entfallen. Pro Profil läuft jetzt eine eigene `ConnectionPool`-Sequenz mit einem internen Mutex (`DEFAULT_CONCURRENCY = 1`). Die Serialisierung pro Server-Host ist robuster als eine frei wählbare Parallelität und verhindert weiterhin `basic-ftp`'s "task already running"-Fehler.
- **`direction` ist Pflicht-Semantik**: Neue Profile können explizit `localToRemote` (Default), `remoteToLocal` oder `bidirectional` setzen. Bidirektionaler Sync wird umgesetzt, indem **zwei Profile** (eines pro Richtung) angelegt werden — ein einzelnes Profil mit `direction: 'bidirectional'` bleibt als Vorgriff auf eine spaetere Implementierung reserviert.

### ✨ Hinzugefügt

- **Mehrere Profile pro Workspace**: Eine `.ftpsync.json` kann jetzt beliebig viele unabhaengige FTP/SFTP-Verbindungen enthalten. Pro Profil laufen eigene `ConnectionPool`, `IgnoreHandler` und `OperationQueue`-Sequenz.
- **Pro-URI-Profil-Aufloesung**: `ConfigManager.getProfileForUri(uri)` liefert das spezifischste Profil (laengstes passendes `localPath`-Praefix) fuer eine Datei oder einen Ordner. Upload-on-Save, manueller Upload/Download und der FTP-Explorer nutzen denselben Aufloeser.
- **Automatische Legacy-Migration**: `migrateLegacyConfig()` erkennt das alte flache Schema und wickelt es lautlos in `{ profiles: [obj] }` mit `name: "default"` ein. `concurrency` wird beim Migrieren verworfen.
- **Strikte Profil-Namen**: Profile muessen jetzt einen `name` haben — die JSON-Schema-Validierung lehnt ansonsten die Konfiguration ab.
- **Multi-Profil-Statusanzeige**: Die Statusbar zeigt bei mehr als einem aktiven Profil einen Suffix wie `Watching (3 profiles)` bzw. `Syncing (3 profiles) ...`.
- **JSDoc-Kontrakte**: Alle zentralen Klassen (`ConnectionPool`, `OperationQueue`, `FileWatcher`, `ConfigManager`) tragen jetzt Klassen-Header, die ihre Verantwortlichkeit und ihre ADR-0001-Schicht explizit benennen.

### 🔧 Behoben

- Die heimliche, oft unnoetige Parallelisierung pro Pool ist weg — Operationen werden pro Profil seriell ausgefuehrt, was Verbindungsabbrueche und Race-Conditions reduziert.
- **Path-Traversal-Schutz konsolidiert**: `resolveSafeLocalPath()` in `src/utils/pathUtils.ts` ersetzt die inline-Pruefung im FTP-Explorer. Wirft jetzt **konsistent** fuer `..`-Segmente und Pfade ausserhalb des `remoteBase` — vorher wurde `..` stillschweigend weggefiltert, was Angriffe wie `/workspace/../../etc/passwd` als gueltige `/workspace/etc/passwd`-Pfade akzeptiert haette. Tests in `pathUtils.test.ts` decken beide Faelle ab.
- **basic-ftp CVEs behoben**: Migration auf `basic-ftp@^6.0.1` (Drop-in-Ersatz) schliesst 1 critical path-traversal in `downloadToDir`, 1 critical CRLF injection und 2 high DoS vulnerabilities. Verbleibende `npm audit --omit=dev`-Treffer: 0.
- **`ssh2`-Internals-Cast dokumentiert**: Der `isConnected()`-Cast auf `_sock.readable` (ssh2-sftp-client@9.1.0) hat einen ausfuehrlichen Header bekommen, der das Upstream-Risiko bei ssh2-Upgrades benennt und den manuellen Test-Aufwand beschreibt.
- **File-Watcher erkennt KI-Agent-Writes**: Profile mit `uploadOnSave: true` aktivieren jetzt auch den FileSystemWatcher — vorher griff nur `onDidSaveTextDocument`, was von externen Tools (Cursor, Cline, Continue, git apply) umgangen wird, die direkt auf Disk schreiben. Zusaetzlich `awaitWriteFinish: { stability: 500 }` damit schnelle write-temp+rename-Sequenzen vom nativen Watcher nicht verpasst werden. Per-Profil-Filter in `handleFileChange` stellt sicher, dass manuell-nur-Profile (`uploadOnSave: false && autoUpload: false`) trotzdem nicht versehentlich hochgeladen werden.

### ✨ Hinzugefügt

- **SecretStorage-Integration**: `SecretManager` in `src/core/secretManager.ts` ersetzt Klartext-Passwoerter in `.ftpsync.json` durch VS-Code `context.secrets` (verschluesselte Speicherung). Profile koennen Passwoerter interaktiv ueber `ftpSync.connect` anfordern; Klartext-Passwoerter werden weiterhin toleriert, aber im Output-Channel mit Warnung markiert. Neuer Befehl `ftpSync.clearCredentials` loescht gespeicherte Secrets ueber eine Profil-Auswahl.
- **`remoteToLocal`-Sync**: Profile mit `direction: 'remoteToLocal'` starten einen Polling-Loop (`watcher.pollIntervalMs`, Default 30 s), der das Remote-Verzeichnis listet, mit dem lokalen `fs`-State abgleicht und neue/geaenderte Dateien herunterlaedt. Vorbereitung fuer `bidirectional` (ADR-0002 / ADR-0003).
- **Tombstones (ADR-0002)**: `TombstoneStore` in `src/core/tombstoneStore.ts` verhindert, dass lokal geloeschte Dateien in `remoteToLocal`-Profilen durch den naechsten Pull wieder zurueckkehren. 7-Tage-TTL, persistiert in `context.globalState`, gekapselt pro `(Workspace, Profil)`.

### 🔒 Sicherheit

- **`resolveSafeLocalPath`** akzeptiert nur noch Pfade, die explizit **innerhalb** des `remoteBase` liegen — Pfade ausserhalb der konfigurierten Remote-Wurzel werden hart abgelehnt.
- **`SecretManager`** verwendet `context.secrets`, das die OS-spezifische Credential-Store (Windows Credential Manager, macOS Keychain, libsecret) nutzt. Klartext in JSON-Dateien ist nur noch ein dokumentierter Migrations-Fallback.

### 📝 Dokumentation

- PRD in `docs/PRD-multi-profile.md` dokumentiert Architektur, Migrationsstrategie und das Verhalten der drei Retry-Schichten.
- Schema-Felder `passwordSecretRef` (optionaler Hint) und `pollIntervalMs` in `schemas/ftpsync.schema.json` ergaenzt.
- `CLAUDE.md` erweitert um Hinweise zu `npm ci` (reproduzierbare Builds ueber `package-lock.json`) und `test:integration`-Skript (vscode-test, derzeit ohne Suite).

## [1.1.5] - 2026-03-31

### ✨ Hinzugefügt

- **FTPS TLS Konfiguration**: Erweiterte TLS-Unterstützung für FTP-Verbindungen
  - `secureOptions.rejectUnauthorized` für Zertifikatsprüfung
  - Unterstützung für `caPath`, `certPath`, `keyPath` und TLS-Key-Passphrase
  - Optionale TLS-Versionen, Ciphers, SNI und `secureProtocol`
  - FTPS-Beispiele für Standard-, Custom- und Self-Signed-Setups

### 📝 Dokumentation

- README um FTPS/TLS-Konfiguration, Beispiele und Sicherheitshinweise erweitert
- Generierte `.ftpsync.json` enthält jetzt einen dedizierten FTPS/TLS-Kommentarblock
- Klarstellung ergänzt, dass `secure` nur für FTP/FTPS gilt und nicht für SFTP

## [1.1.4] - 2025-12-13

### 🔧 Behoben

- **Verzeichnis-Handling beim File Watcher**: FileWatcher erkennt jetzt korrekt ob es sich um eine Datei oder ein Verzeichnis handelt
  - Leere Ordner werden nicht mehr als "unbekannte Datei" auf den Server hochgeladen
  - Verzeichnisse nutzen `ensureDirectory()` statt `uploadFile()`
- **Download-Pfad-Berechnung verbessert**: Robustere Pfad-Normalisierung
  - Entfernt Laufwerksbuchstaben aus relativePath (C:, E:, etc.)
  - Verhindert doppelte Pfade durch korrekte basePath-Berechnung
  - Filtert leere Pfad-Segmente und "." Komponenten

## [1.1.3] - 2025-12-11

### ✨ Hinzugefügt

- **Progress Indicators**: Fortschrittsanzeige für Upload/Download Operationen
  - Einzelne Dateien zeigen Fortschrittsbalken
  - Ordner-Uploads/-Downloads zeigen Datei-Counter (z.B. "5/20 uploading file.ts")
- **Download Folder**: Komplette Ordner rekursiv vom Server herunterladen
- **Auto-Dismiss Notifications**: Benachrichtigungen verschwinden automatisch
  - Info/Success: 3 Sekunden
  - Warnings: 5 Sekunden
  - Errors: Bleiben bis zum Schließen
- **SSH Key Auth Dokumentation**: Ausführliche Anleitung in Config-Template

### 🔧 Behoben

- **Download Pfad Bug**: Korrigierte Pfadberechnung bei Downloads
  - Führende Slashes werden entfernt um doppelte Laufwerksbuchstaben zu vermeiden
  - z.B. `e:\workspace\e:\path` → `e:\workspace\path`

## [1.1.2] - 2025-12-11

### 🔧 Behoben

- **Ctrl+S Spam Fix**: Mutex Lock verhindert parallele FTP-Operationen
  - "User launched a task while another one is still running" Error behoben
  - Nur eine FTP-Operation gleichzeitig pro Verbindung
- **Doppelte Uploads verhindert**: `activeUploads` Set trackt laufende Uploads
  - FileWatcher ignoriert Dateien die bereits von uploadOnSave hochgeladen werden
  - Verhindert Konflikte zwischen uploadOnSave und Watcher
- **Verbessertes Debouncing**: 500ms statt 300ms, bessere Duplicate Detection

### ✨ Verbessert

- **Activity Bar Icon**: Neues Outline-Style Cloud Icon (20x20px)
- **100ms Delay** zwischen Queue-Operationen verhindert Server-Flooding

## [1.1.1] - 2025-12-11

### 🔧 Behoben

- **"Client is closed" Error**: Verbesserte Erkennung von geschlossenen Verbindungen
  - `isConnected()` prüft jetzt den tatsächlichen Client-Status
  - Automatische Reconnection wenn Client extern geschlossen wurde
- **"Transfer strategies" Error**: Wird jetzt als Connection-Error erkannt und löst Reconnect aus
- **FTP Client Status**: `closed` Property wird jetzt korrekt geprüft
- **SFTP Client Status**: Socket-Status wird jetzt korrekt geprüft

## [1.1.0] - 2025-12-11

### ✨ Hinzugefügt

- **Professional English README**: Komplett überarbeitete Dokumentation mit Badges
- **GitHub Repository**: Projekt ist jetzt auf GitHub verfügbar

## [1.0.3] - 2025-12-11

### 🔧 Behoben

- **Connection Pool Management**: Globale Verbindungsbegrenzung eingeführt (max. 2 gleichzeitige Verbindungen)
- **530 Max Connections Error**: Intelligente Behandlung des "maximum number of connections" Fehlers
  - Automatische 60-Sekunden Wartezeit bei Überschreitung des Server-Limits
  - Keine sofortigen Reconnect-Versuche bei Rate-Limiting
- **FileWatcher Memory Leak**: FileWatcher-Instanzen werden jetzt korrekt wiederverwendet
- **Operation Queue**: Sequentielle Verarbeitung (Concurrency=1) verhindert Server-Überlastung

### ✨ Verbessert

- **Konfigurationsdatei**: Ausführliche deutsche Kommentare und Erklärungen in der automatisch erstellten `.ftpsync.json`
- **JSONC Support**: Konfigurationsdateien können jetzt Kommentare enthalten
- **FTP Explorer**: Ordner werden jetzt aufgeklappt statt "betreten" - bessere Übersicht

### 📝 Dokumentation

- Detaillierte Inline-Dokumentation für alle Konfigurationsoptionen
- Beispiele für Glob-Patterns und Pfadkonfiguration
- Warnhinweise bei kritischen Optionen (z.B. autoDelete)

## [1.0.1] - 2025-12-10

### 🔧 Behoben

- Verbindungsprobleme bei mehreren gleichzeitigen Uploads
- Status Bar Updates bei laufenden Operationen

### ✨ Verbessert

- Bessere Fehlerbehandlung bei Netzwerkproblemen
- Exponentielles Backoff bei Reconnect-Versuchen

## [1.0.0] - 2025-12-08

### 🎉 Erste stabile Version

### ✨ Features

- **FTP & SFTP Unterstützung**: Vollständige Unterstützung beider Protokolle
- **Automatischer Upload**: Dateien werden beim Speichern automatisch hochgeladen
- **File Watcher**: Überwacht Dateiänderungen und synchronisiert automatisch
- **FTP Explorer**: Durchsuchen und Verwalten von Remote-Dateien direkt in VS Code
- **SSH Key Authentifizierung**: Sichere Anmeldung mit privaten SSH-Schlüsseln
- **.gitignore Support**: Respektiert automatisch `.gitignore` Regeln
- **Benutzerdefinierte Ignore-Patterns**: Flexible Ausschluss-Regeln mit Glob-Patterns
- **Status Bar Integration**: Zeigt Verbindungsstatus und laufende Operationen
- **Kontextmenü**: Upload/Download direkt aus dem Explorer-Kontextmenü
- **JSON Schema Validierung**: IntelliSense und Validierung für Konfigurationsdateien

### 🔧 Konfiguration

- Konfigurationsdatei in `.vscode/.ftpsync.json`
- Unterstützt mehrere Workspace-Ordner
- Auto-Reload bei Konfigurationsänderungen

## [0.0.1] - 2024-12-05

### 🚀 Initial Release

- Erste Beta-Version der Extension
- Grundlegende FTP/SFTP Funktionalität
- Proof of Concept für File Watching

---

## Legende

- 🎉 Neue Hauptversion
- ✨ Neue Features / Verbesserungen
- 🔧 Bugfixes
- 📝 Dokumentation
- ⚠️ Breaking Changes
- 🗑️ Entfernt
- 🔒 Sicherheit
