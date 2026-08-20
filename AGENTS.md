# AGENTS.md

Compact orientation for OpenCode sessions in this repo. The German-language
deep-dive lives in `CLAUDE.md` — read it for architecture, boot sequence, and
non-obvious code conventions. This file only collects facts an agent would
otherwise miss or guess wrong.

## Project

VS Code extension **FTP/SFTP Sync Watcher** (`ftp-sync-watcher`, publisher
`ThaLoco0ne`). Activates on `onStartupFinished`. Local ↔ FTP/SFTP/FTPS sync
via file watcher, `uploadOnSave`, manual commands, and an Activity Bar tree
view. Multi-profile per workspace; per-profile `ConnectionPool`.

## Build / Lint / Test

```bash
npm ci                  # package-lock.json is committed; prefer over npm install
npm run compile         # tsc → out/  (required before tests; mocha reads out/test/unit/**/*.test.js)
npm run watch           # tsc --watch for dev iteration
npm run lint            # eslint src --ext ts
npm run test:unit       # mocha — 57 unit tests in src/test/unit/, pure Node, no vscode mock
npm test                # alias for npm run test:unit (NOT vscode-test — was a bug)
npm run test:integration # vscode-test — suite does not exist yet, reserved
npm run bundle          # esbuild → out/extension.js (production, minified)
npm run package         # verify:bundle + vsce package → .vsix
```

Non-obvious build facts:

- **Two-stage pipeline.** `compile` runs `tsc` (dev + tests, everything into
  `out/`). `vscode:prepublish` runs `tsc` + `esbuild --production`, and
  esbuild replaces `out/extension.js` with the minified bundle (incl. JS
  deps). `ssh2` is left external (native `.node` binaries). See
  `esbuild.config.mjs`.
- **`npm run package` has a `verify:bundle` guard.** It refuses to build the
  VSIX if `out/extension.js` is < 50 KB — protects against a stale tsc
  output clobbering the bundle. If you see the error, run `npm run bundle`.
- **`out/` is gitignored.** `*.js`, `*.js.map`, `*.d.ts` are gitignored
  except `.d.ts` under `src/` and `scripts/**/*.js`.
- **No `.vscode/launch.json` in the working tree.** F5-to-debug workflow is
  not wired up locally — don't assume it exists; create it if needed.

## Architecture (one-line map)

- `src/extension.ts` — `activate()`/`deactivate()`, wires singletons, calls
  `commandHandler.autoStartUploadOnSaveWatchers()` after `autoStart()`.
- `src/core/configManager.ts` — JSONC loading + config-file watcher +
  secret resolution + `getProfileForUri(uri)` (longest-prefix match).
- `src/core/connectionPool.ts` — connection lifecycle, per-connection mutex,
  `globalConnectionManager` (`maxGlobalConnections = 2`, 120 s queue
  timeout), 530-rate-limit window (60 s).
- `src/core/fileWatcher.ts` — debounce keyed by absolute path (`debounceMs
  = 500`), `activeUploads` Set, polling loop for `remoteToLocal`. Does NOT
  use `awaitWriteFinish` (deliberate — see CHANGELOG v2.0.0).
- `src/core/operationQueue.ts` — sequential, `DEFAULT_CONCURRENCY = 1`.
- `src/core/secretManager.ts` — `context.secrets` wrapper, key
  `ftpSync.${workspaceFolder}.${profileName}.${password|passphrase}`.
- `src/core/tombstoneStore.ts` — globalState deletion markers, 7-day TTL
  (ADR-0002). Prevents `remoteToLocal` from resurrecting locally deleted
  files.
- `src/core/ignoreHandler.ts` — `.gitignore` + custom globs via `ignore`.
- `src/clients/{ftpClient,sftpClient,remoteClient}.ts` — `basic-ftp` and
  `ssh2-sftp-client` implementations of the `RemoteClient` abstract.
- `src/commands/commandHandler.ts` — all `ftpSync.*` commands and
  `autoStartUploadOnSaveWatchers()`.
- `src/ui/{statusBar,ftpExplorer}.ts` — status bar (syncCount is a ref
  counter) + Activity Bar tree view (own `RemoteClient`, separate from
  pool).
- `src/utils/pathUtils.ts` — `resolveSafeLocalPath()` is the
  security-critical path resolver. Use it; never inline a `..` check.
- `src/types/config.ts` — `DEFAULT_PROFILE`, `mergeProfileWithDefaults`,
  `resolveProfilePaths` (pure, unit-tested).
- `schemas/ftpsync.schema.json` — IntelliSense for
  `**/.vscode/.ftpsync.json`.

## Things agents would silently get wrong

- **Language.** Source-code comments, changelog entries, and config-file
  template comments are German. Match the language for new comments and
  CHANGELOG additions.
- **`activeUploads` coordination.** `uploadOnSave` and the watcher
  otherwise double-upload. `uploadFile(...)` adds the path to
  `activeUploads` AND clears the debounce timer; remove after a 1000 ms
  `setTimeout` grace. Mirror this when adding a new sync entry point.
- **Schema coupling.** `schemas/ftpsync.schema.json`,
  `DEFAULT_PROFILE`/`mergeProfileWithDefaults` in `src/types/config.ts`,
  and the template-literal inside `ConfigManager.createConfig(...)` must
  all move together. The schema is what gives users IntelliSense — keep
  descriptions accurate.
- **CHANGELOG is the source of truth.** Append under
  `### ✨/🔧/📝/🔒/⚠️/🗑️` (existing German Keep-a-Changelog format).
  Reference the affected config key or component.
- **`secure`/`secureOptions` apply only to FTP/FTPS.** SFTP ignores them —
  it is encrypted via SSH and authenticates with `privateKeyPath` /
  `passphrase`. Do not surface TLS fields in SFTP configs.
- **Release artifacts are committed.** `ftp-sync-watcher-*.vsix` lives at
  repo root for GitHub Releases (`.gitignore` excludes new ones once a
  release is cut). Do not mass-delete them.
- **`basic-ftp` pinned at `^6.0.1`.** v6 dropped `timeout` from the
  constructor (set via `client.timeout(...)`) and merged FTPS into
  `Client` with `secure: true`. Audit before bumping.
- **`package-lock.json` is committed since v2.0.0.** Use `npm ci`.
- **`bidirectional` is accepted but unimplemented.** Values are stored; no
  transfers happen. Model two profiles (one per direction) instead.
- **`FileWatcher.start()` race-safe via `startPromise` cache** (v2.0.3).
  Preserve the cache when refactoring; without it, concurrent
  `autoStartUploadOnSaveWatchers` + early-save paths double-register.
- **`ConnectionPool.executeWithRetry`** is the only entry point for remote
  ops. Wraps the mutex, retries ≤3×, triggers reconnect on
  `isConnectionError` keywords. Extend the keyword list carefully.

## References

- `CLAUDE.md` — German deep-dive (architecture, boot sequence, conventions).
- `CHANGELOG.md` — shipped behavior; bug fixes and features land here.
- `CONTEXT.md` — domain glossary (Profile, Direction, Trigger, Sync,
  Tombstone, Watcher, Remote Client, Connection Pool, Connection Slot,
  Explorer, Workspace Folder, Operation, Transfer, Status). German, with
  English *Avoid* aliases.
- `docs/PRD-multi-profile.md` — multi-profile architecture and the three
  retry layers.
- `.github/copilot-instructions.md` — Copilot-specific subset; safe to
  ignore for OpenCode work but kept for parity.