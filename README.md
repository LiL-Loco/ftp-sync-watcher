# FTP/SFTP Sync Watcher

Eine VS Code Extension für automatischen Upload und Synchronisation von Dateien auf FTP/SFTP Server.

## Features

- 🔄 **Automatischer Upload beim Speichern** - Dateien werden automatisch hochgeladen, wenn sie gespeichert werden
- 👁️ **File Watcher** - Überwacht Dateiänderungen und synchronisiert automatisch
- 🗑️ **Auto-Delete** - Optionales Löschen von Remote-Dateien, wenn lokale Dateien gelöscht werden
- 📁 **.gitignore Support** - Respektiert `.gitignore` Regeln
- 🚫 **Benutzerdefinierte Exclude-Patterns** - Schließe Dateien und Ordner mit Glob-Patterns aus
- 🔐 **SFTP mit SSH Key Support** - Sichere Verbindung mit Private Key Authentifizierung
- 📊 **Status Bar Integration** - Zeigt den aktuellen Sync-Status an
- ⚡ **Robuste Verbindung** - Automatische Wiederverbindung bei Verbindungsabbrüchen
- 🔁 **Operation Queue** - Verhindert hängende Uploads durch Timeout und Retry-Mechanismen
- 🏃 **Concurrent Uploads** - Mehrere Dateien gleichzeitig hochladen

## Warum diese Extension?

Andere FTP/SFTP Extensions haben oft das Problem, dass sie nach einer Weile **aufhören zu funktionieren** und Dateien nicht mehr hochladen. Diese Extension löst das durch:

- **Automatische Wiederverbindung** mit exponentialem Backoff (bis zu 5 Versuche)
- **Timeout für jede Operation** - keine hängenden Uploads mehr
- **Health-Checks** - erkennt Verbindungsprobleme bevor sie zum Problem werden
- **Operation Queue** - Uploads werden in einer Queue verarbeitet, nicht blockierend
- **Retry-Mechanismus** - Fehlgeschlagene Uploads werden automatisch wiederholt

## Installation

1. Öffne VS Code
2. Drücke `Ctrl+P` und gib ein: `ext install ftp-sync-watcher`
3. Oder installiere manuell mit der VSIX-Datei

## Konfiguration

Erstelle eine `.ftpsync.json` Datei im Root-Verzeichnis deines Projekts:

### SFTP Konfiguration (empfohlen)

```json
{
  "name": "Production Server",
  "protocol": "sftp",
  "host": "example.com",
  "port": 22,
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "remotePath": "/var/www/html",
  "uploadOnSave": true,
  "watcher": {
    "enabled": true,
    "files": "**/*",
    "autoUpload": true,
    "autoDelete": false
  },
  "ignore": [".git", ".vscode", "node_modules", ".ftpsync.json", "*.log"],
  "useGitIgnore": true
}
```

### FTP Konfiguration

```json
{
  "name": "FTP Server",
  "protocol": "ftp",
  "host": "ftp.example.com",
  "port": 21,
  "username": "ftpuser",
  "password": "your-password",
  "remotePath": "/public_html",
  "secure": true,
  "uploadOnSave": true
}
```

### Konfigurationsoptionen

| Option               | Typ             | Standard             | Beschreibung                               |
| -------------------- | --------------- | -------------------- | ------------------------------------------ |
| `name`               | string          | -                    | Name für dieses Verbindungsprofil          |
| `protocol`           | "ftp" \| "sftp" | "sftp"               | Verbindungsprotokoll                       |
| `host`               | string          | **erforderlich**     | Hostname oder IP-Adresse                   |
| `port`               | number          | 22 (SFTP) / 21 (FTP) | Port-Nummer                                |
| `username`           | string          | **erforderlich**     | Benutzername                               |
| `password`           | string          | -                    | Passwort (nicht empfohlen für SFTP)        |
| `privateKeyPath`     | string          | -                    | Pfad zur SSH Private Key Datei             |
| `passphrase`         | string          | -                    | Passphrase für verschlüsselten Private Key |
| `remotePath`         | string          | **erforderlich**     | Remote-Verzeichnispfad                     |
| `localPath`          | string          | "."                  | Lokales Verzeichnis relativ zum Workspace  |
| `uploadOnSave`       | boolean         | true                 | Automatisch beim Speichern hochladen       |
| `watcher.enabled`    | boolean         | true                 | File Watcher aktivieren                    |
| `watcher.files`      | string \| false | "\*_/_"              | Glob-Pattern für zu überwachende Dateien   |
| `watcher.autoUpload` | boolean         | true                 | Änderungen automatisch hochladen           |
| `watcher.autoDelete` | boolean         | false                | Remote-Dateien bei Löschung entfernen      |
| `ignore`             | string[]        | [...]                | Glob-Patterns zum Ausschließen             |
| `useGitIgnore`       | boolean         | true                 | .gitignore Regeln anwenden                 |
| `secure`             | boolean         | false                | FTPS (FTP über TLS) verwenden              |
| `timeout`            | number          | 30000                | Verbindungs-Timeout in ms                  |
| `debug`              | boolean         | false                | Debug-Logging aktivieren                   |

## Commands

Alle Commands sind über die Command Palette (`Ctrl+Shift+P`) verfügbar:

| Command                               | Beschreibung                       |
| ------------------------------------- | ---------------------------------- |
| `FTP Sync: Upload Current File`       | Aktuelle Datei hochladen           |
| `FTP Sync: Upload Folder`             | Ordner hochladen                   |
| `FTP Sync: Download Current File`     | Aktuelle Datei herunterladen       |
| `FTP Sync: Start Watcher`             | File Watcher starten               |
| `FTP Sync: Stop Watcher`              | File Watcher stoppen               |
| `FTP Sync: Toggle Watcher`            | File Watcher ein-/ausschalten      |
| `FTP Sync: Create Configuration File` | Neue Konfigurationsdatei erstellen |
| `FTP Sync: Show Output Channel`       | Ausgabekanal anzeigen              |

## Kontextmenü

Rechtsklick auf Dateien/Ordner im Explorer:

- **Upload File/Folder** - Hochladen
- **Download File/Folder** - Herunterladen

## Status Bar

Die Status Bar zeigt den aktuellen Zustand an:

- ☁️ **FTP Sync** - Watcher inaktiv (klicken zum Starten)
- 👁️ **Watching** - Watcher aktiv (klicken zum Stoppen)
- 🔄 **Syncing...** - Upload läuft
- ❌ **Error** - Fehler aufgetreten (Output für Details prüfen)

## Glob-Patterns für Ignore

Beispiele für Exclude-Patterns:

```json
{
  "ignore": [
    ".git", // .git Ordner
    ".vscode", // .vscode Ordner
    "node_modules", // node_modules Ordner
    "*.log", // Alle .log Dateien
    "**/*.map", // Alle .map Dateien in allen Ordnern
    "dist/**", // Alles im dist Ordner
    "!dist/index.html", // Außer dist/index.html
    "temp*", // Alle Dateien/Ordner die mit temp beginnen
    "**/.DS_Store" // Alle .DS_Store Dateien
  ]
}
```

## Watcher-Patterns

Beispiele für Watch-Patterns:

```json
{
  "watcher": {
    "files": "src/**/*.{ts,js,css,html}",
    "autoUpload": true,
    "autoDelete": false
  }
}
```

| Pattern         | Beschreibung                  |
| --------------- | ----------------------------- |
| `**/*`          | Alle Dateien in allen Ordnern |
| `src/**`        | Alle Dateien im src Ordner    |
| `*.js`          | Alle JS-Dateien im Root       |
| `**/*.{js,ts}`  | Alle JS und TS Dateien        |
| `!**/*.test.js` | Ausschließen von Test-Dateien |

## Sicherheitshinweise

⚠️ **Wichtig:**

- Speichere keine Passwörter in der `.ftpsync.json` - verwende SSH Keys für SFTP
- Füge `.ftpsync.json` zu `.gitignore` hinzu, wenn sensible Daten enthalten sind
- Verwende `privateKeyPath` anstelle von `password` für SFTP-Verbindungen

## Problembehandlung

### Verbindungsprobleme

1. Überprüfe Host, Port und Zugangsdaten
2. Stelle sicher, dass der Server erreichbar ist
3. Aktiviere `"debug": true` für detaillierte Logs
4. Prüfe den Output Channel (`FTP Sync: Show Output Channel`)

### Dateien werden nicht hochgeladen

1. Prüfe die `ignore` Patterns
2. Stelle sicher, dass `uploadOnSave` aktiviert ist
3. Prüfe, ob die Datei von `.gitignore` ausgeschlossen wird

### SSH Key Probleme

1. Stelle sicher, dass der Key im OpenSSH Format ist
2. Prüfe die Dateiberechtigungen des Private Keys
3. Bei verschlüsselten Keys: `passphrase` angeben

## Lizenz

MIT License

## Beitragen

Contributions sind willkommen! Bitte erstelle einen Pull Request oder melde Issues auf GitHub.
