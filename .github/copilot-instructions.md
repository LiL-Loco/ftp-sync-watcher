<!-- Use this file to provide workspace-specific custom instructions to Copilot. -->

# FTP/SFTP Sync Watcher Extension

## Project Overview

VS Code Extension für automatischen Upload von Dateien auf FTP/SFTP Server mit File Watcher Funktionalität.

## Tech Stack

- TypeScript
- VS Code Extension API
- basic-ftp (FTP Client)
- ssh2-sftp-client (SFTP Client)
- ignore (gitignore Parser)

## Project Structure

```
src/
├── extension.ts        # Extension Entry Point
├── types/              # TypeScript Interfaces und Typen
├── clients/            # FTP/SFTP Client Implementierungen
├── core/               # Kernfunktionalität (ConfigManager, FileWatcher, IgnoreHandler)
├── commands/           # VS Code Commands
├── ui/                 # Status Bar und UI Komponenten
└── utils/              # Hilfsfunktionen (Logger, Path Utils)
```

## Configuration

Die Extension verwendet eine `.ftpsync.json` Datei im Workspace Root.

## Commands

- ftpSync.uploadFile
- ftpSync.uploadFolder
- ftpSync.downloadFile
- ftpSync.downloadFolder
- ftpSync.startWatcher
- ftpSync.stopWatcher
- ftpSync.toggleWatcher
- ftpSync.createConfig
- ftpSync.showOutput

## Development

```bash
npm install
npm run compile
# F5 zum Testen in Extension Development Host
```
