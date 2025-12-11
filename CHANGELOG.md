# Changelog

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und dieses Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

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
