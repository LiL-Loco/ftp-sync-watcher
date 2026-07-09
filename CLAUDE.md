# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension **FTP/SFTP Sync Watcher** (`ftp-sync-watcher`, publisher `ThaLoco0ne`). Activates on `onStartupFinished`. Synchronizes local files with FTP/SFTP/FTPS servers via file watcher, `uploadOnSave`, and manual commands. Source code, comments, and commit history are in German — match that language in new comments and changelog entries.

## Build / Lint / Test Commands

```bash
npm ci                  # reproducible install (package-lock.json ist committed seit v2.0.0)
npm install             # lockfile-update Variante (npm ci bevorzugen)
npm run compile         # tsc -p ./. → out/
npm run watch           # tsc --watch for dev iteration
npm run lint            # eslint src --ext ts
npm run test:unit       # mocha — 57 unit tests in src/test/unit/
npm test                # alias für npm run test:unit (früher vscode-test — Bug)
npm run test:integration # vscode-test (Suite existiert noch nicht, vorbereitet)
```

- Output goes to `out/` (committed-vs-ignored: `*.js`, `*.js.map`, `*.d.ts` are gitignored; `out/` is gitignored too).
- `.vscode/launch.json` is already configured: **F5** launches an Extension Development Host with the prebuild task.
- Unit tests live in `src/test/unit/` and are pure Node + mocha — they do **not** require the VS Code test host. Run `npm run test:unit` after `npm run compile`. `vscode-test` (`test:integration`) is reserved for future integration tests that need the real VS Code runtime.
- `npm test` ist seit v2.0.0 KEIN `vscode-test`-Aufruf mehr, sondern ein Alias für `npm run test:unit`. Hintergrund: `vscode-test` brach mit "Could not find a .vscode-test file" ab, sobald keine Suite existierte.
- The icon generation helper `scripts/create-icon.js` is **not** a build step. Run only if the `media/icon.png` needs regenerating (`node scripts/create-icon.js`).

## High-Level Architecture

```
src/
├── extension.ts          # activate()/deactivate(), wires everything
├── types/                # FtpSyncProfile, FtpSyncConfigFile, Direction, defaults, resolveProfilePaths
├── clients/              # RemoteClient (abstract) + FtpClient (basic-ftp) + SftpClientWrapper (ssh2-sftp-client)
├── core/
│   ├── configManager.ts  # loads/strips JSONC .vscode/.ftpsync.json, watches config files, secret resolution
│   ├── fileWatcher.ts    # VS Code FileSystemWatcher + debounce + queue + active-uploads tracking + polling-loop for remoteToLocal
│   ├── connectionPool.ts # reconnect/backoff/530-rate-limit + operation mutex
│   ├── operationQueue.ts # priority queue, retries, sequential processing
│   ├── secretManager.ts  # VS-Code context.secrets wrapper (ftpSync.* namespace)
│   ├── tombstoneStore.ts # globalState-basierte Loesch-Markierungen mit TTL (ADR-0002)
│   └── ignoreHandler.ts  # combines .gitignore + custom glob patterns via `ignore` package
├── commands/             # CommandHandler — registers all `ftpSync.*` commands
├── ui/                   # StatusBar + FtpExplorerProvider (Activity Bar tree view)
├── utils/                # Logger, pathUtils (resolveSafeLocalPath/remoteToLocalPath), pathAdapters (vscode-touchpoints only), notifications, progress
└── test/unit/            # mocha — pure-Function-Tests ohne vscode-Mock
```

**Boot sequence** (`extension.ts`):
1. `Logger.init(context)` — creates the `FTP Sync` output channel.
2. `StatusBar` → `ConfigManager.initialize()` (loads `.vscode/.ftpsync.json` from every workspace folder, JSONC-parseable, schema-validated via `schemas/ftpsync.schema.json`, profiles per folder).
3. `CommandHandler.registerCommands(context)` then creates the FTP Explorer `TreeView` (`ftpExplorerView`) and wires the per-item commands (`ftpSync.downloadRemoteFile`, `ftpSync.deleteRemoteFile`, `navigateUp`, `refresh`, `connect`, `disconnect`). The explorer carries one `FtpSyncProfile` per connected folder (currently first profile; per-profile picker is a future feature).
4. `onDidSaveTextDocument` listener calls `commandHandler.handleDocumentSave(...)` — resolves the responsible profile via `getProfileForUri(uri)`, skips non-`file` schemes and the `.ftpsync.json` file itself.
5. `commandHandler.autoStart()` honours the `ftpSync.autoStartWatcher` setting. `initialize()` is idempotent (disposes old watchers before installing new ones) — see `disposeWatchers()` in `src/core/configManager.ts`.

**Per-profile data flow**: `extension.ts` keeps module-level singletons (`configManager`, `commandHandler`, `statusBar`, `ftpExplorer`). `CommandHandler` caches one `FileWatcher` per workspace path; each `FileWatcher` holds one `ConnectionPool` **per profile** in that workspace, so manual commands and upload-on-save can dispatch to the right server via `ConfigManager.getProfileForUri(uri)` (longest-prefix match on `localPath`).

## Non-Obvious Conventions

- **Two layers of serialisation around basic-ftp.** `basic-ftp` throws *"User launched a task while another one is still running"* if two ops overlap. `ConnectionPool` therefore enforces both a per-connection `operationMutex` (chains promises) and goes through the global `globalConnectionManager` singleton (`maxGlobalConnections = 2`, 120 s queue timeout). `OperationQueue` is now strictly sequential (`DEFAULT_CONCURRENCY = 1`); the user-configurable `concurrency` profile field was removed in v2.0.0 because it was almost always set to 1 in practice and only added a second knob to misconfigure.
- **530 max-connections handling.** `ConnectionPool.isRateLimitError` watches for `530` + `maximum`; the global manager then enters a 60 s `rateLimitedUntil` window. During this window `acquireSlot` blocks the caller instead of retrying — do not "fix" this with a busy-retry.
- **`FileWatcher.activeUploads` Set.** `uploadOnSave` and the watcher would otherwise double-upload the same file. `uploadFile(...)` adds the path to `activeUploads` *and* clears the debounce timer, then removes it after a `setTimeout(..., 1000)` grace window. Mirror this if you add new sync entry points.
- **`uploadOnSave` aktiviert den FileSystemWatcher.** Seit dem KI-Agent-Fix (v2.0.0 Patch) gilt: sobald ein Profil `uploadOnSave: true` hat, wird zusaetzlich `vscode.workspace.createFileSystemWatcher(...)` mit `awaitWriteFinish: { stability: 500 }` registriert. Hintergrund: Tools wie Cursor, Cline, Continue oder `git apply` schreiben direkt auf Disk ohne VS-Code-Save-Flow — `onDidSaveTextDocument` sieht diese Writes nicht. `awaitWriteFinish` absorbiert schnelle write-temp+rename-Sequenzen. Manuell-nur-Profile (`uploadOnSave: false && autoUpload: false`) bleiben aussen vor (per-Profil-Filter in `handleFileChange`).
- **Debounce is keyed by absolute path** (`uri.fsPath`), not by `(type, path)` — many `onDidChange` events for one save collapse to one upload. Default `debounceMs = 500` (raised from 300 in 1.1.2 to absorb `Ctrl+S` spam).
- **`StatusBar.syncCount` is a ref counter**, not a flag. `showSyncing()`/`endSyncing()` increment/decrement, and only revert to `watching` when it hits zero — prevents state flicker when concurrent ops overlap.
- **`secure`/`secureOptions` apply only to FTP.** `SftpClientWrapper.connect()` ignores them entirely (SFTP is encrypted by SSH; auth is via `privateKeyPath`/`passphrase`). Do not surface TLS fields in SFTP configs.
- **Default port** is computed via `getDefaultPort(protocol, secure)` → 22 SFTP, 21 FTP, 990 FTPS.
- **Config file is JSONC**, not strict JSON. `ConfigManager.stripJsonComments` is a hand-rolled tokenizer that respects string boundaries and escape sequences. Do not replace it with a regex stripper — comments inside strings would break.
- **`ConfigManager` is keyed by workspace folder fsPath**, then by profile name (`Map<string, Map<string, FtpSyncProfile>>`). Multi-root workspaces get one config per folder under `<folder>/.vscode/.ftpsync.json`, and each config holds an array of profiles under the `profiles` key. Legacy flat-object configs are silently migrated (see `migrateLegacyConfig` in `src/types/config.ts`). JSON schema is registered globally via `contributes.jsonValidation` for `**/.vscode/.ftpsync.json`.
- **`Path handling`** — remote paths always use `/` (POSIX) regardless of host OS; `pathUtils.normalizePath` does the conversion. Local↔remote mapping goes through `localToRemotePath`/`remoteToLocalPath`. **Sicherheits-kritische Pfad-Aufloesung** laeuft ueber `resolveSafeLocalPath()` in `src/utils/pathUtils.ts` — wirft hart fuer `..`-Segmente und fuer Pfade ausserhalb des `remoteBase`. Der FTP-Explorer nutzt diese Funktion ausschliesslich (kein inline-Check mehr).
- **SecretStorage** — Klartext-Passwoerter in `.ftpsync.json` sind seit v2.0.0 deprecated. `SecretManager` (in `src/core/secretManager.ts`) liest aus `context.secrets`, schluesselt nach Schema `ftpSync.${workspaceFolder}.${profileName}.${password|passphrase}`. Klartext bleibt als Migrations-Fallback aktiv und erzeugt eine Warnung im Output-Channel. Profile ohne `password` und ohne Secret triggern eine InputBox bei `ftpSync.connect`. `ftpSync.clearCredentials` loescht Secrets explizit.
- **Polling-Loop fuer `remoteToLocal`** — `FileWatcher` startet fuer Profile mit `direction: 'remoteToLocal'` einen `setInterval`-basierten Polling-Loop (`watcher.pollIntervalMs`, Default 30 s). Tombstones verhindern, dass lokal geloeschte Dateien durch den naechsten Pull wieder zurueckkehren. `bidirectional` ist noch nicht implementiert — die Werte werden akzeptiert, fuehren aber (noch) keine Transfers aus.
- **`resolveProfilePaths` ist pure** — die Pfad-Aufloesung aus `ConfigManager.prepareProfile` wurde nach `types/config.ts` extrahiert, damit sie ohne vscode-Mock getestet werden kann. `prepareProfile.test.ts` verifiziert relativ/absolut/leer, TLS-Pfade und Immutability.
- **`FtpExplorerProvider` keeps its own `RemoteClient`** (separate from `ConnectionPool`), so the explorer's connection is independent of the watcher's. The view is rooted at `config.remotePath` and "Go up" (`ftpSync.navigateUp`) is disabled at that root.
- **`ConnectionPool.executeWithRetry`** is the single entry point for any remote op; it wraps the `operationMutex`, retries up to 3×, and triggers reconnection on connection-class errors (`isConnectionError` keyword list is the source of truth — extend it carefully).

## Things to Watch For

- The CHANGELOG is the source of truth for shipped behavior. New bug fixes and features should append an entry following the existing German-language `### ✨/🔧/📝/🔒/⚠️` style and reference the affected config key or component.
- Release artifacts (`ftp-sync-watcher-*.vsix`) are committed to the repo root for GitHub Releases — `.gitignore` excludes `*.vsix` only inside the working tree once the next release is cut. Don't mass-delete these.
- Schema must stay in sync with `types/config.ts` (`DEFAULT_PROFILE`, `mergeProfileWithDefaults`). The JSON schema in `schemas/ftpsync.schema.json` is what gives users IntelliSense — keep the descriptions accurate when adding fields.
- `SftpClient.isConnected()` reflects on the underlying `ssh2` socket via a private field cast (`as unknown as { client?: { _sock?: ... } }`); if `ssh2-sftp-client` upgrades and renames internals, this check will silently fall back to the cached flag and miss disconnects. Header-Kommentar in `src/clients/sftpClient.ts` beschreibt das Upgrade-Protokoll.
- The user-facing default config template lives inline in `ConfigManager.createConfig(...)` as a template-literal string (German comments, box-drawing separators). Update it in lockstep with new config keys.
- **`basic-ftp` auf v6.0.1 pinnen.** Vor jedem Bump: `npm audit` pruefen, Migrations-Bemerkungen lesen. v6 hat einen anderen Konstruktor (kein `timeout` mehr im Konstruktor — wird ueber `client.timeout(...)` gesetzt) und FTPS wurde zu `Client` mit `secure: true` zusammengefuehrt.
- **`package-lock.json` ist seit v2.0.0 committed.** `npm ci` fuer CI und frische Checkouts; `npm install` nur, wenn Dependencies absichtlich aktualisiert werden sollen.

## Key Files

- `src/extension.ts` — activation entry point
- `src/core/connectionPool.ts` — connection lifecycle, mutex, rate limit, health checks
- `src/core/fileWatcher.ts` — debounce + queue + active-upload coordination + polling-loop for remoteToLocal
- `src/core/configManager.ts` — JSONC loading + config file watcher + secret resolution
- `src/core/secretManager.ts` — VS-Code `context.secrets` wrapper
- `src/core/tombstoneStore.ts` — Loesch-Markierungen mit TTL (ADR-0002)
- `src/clients/{ftpClient,sftpClient,remoteClient}.ts` — protocol implementations of `RemoteClient`
- `src/commands/commandHandler.ts` — all `ftpSync.*` command handlers
- `src/ui/{statusBar,ftpExplorer}.ts` — status bar + Activity Bar tree view
- `src/utils/pathUtils.ts` — `resolveSafeLocalPath` ist die sicherheitskritische Pfad-Aufloesung
- `src/utils/pathAdapters.ts` — vscode-Touchpoints (`getWorkspaceFolder`, `getWorkspaceFolders`)
- `schemas/ftpsync.schema.json` — IntelliSense for `.ftpsync.json`
- `package.json` — `contributes.*` (commands, views, menus, configuration, jsonValidation) and `scripts`