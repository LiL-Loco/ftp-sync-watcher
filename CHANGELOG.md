# Changelog

Alle wichtigen Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
und dieses Projekt verwendet [Semantic Versioning](https://semver.org/lang/de/).

## [2.0.5] - 2026-08-21

### ✨ Hinzugefügt

- **`Copy Remote Path` im FTP-Explorer-Kontextmenue**: Rechtsklick auf eine Datei oder einen Ordner im FTP-Explorer bietet jetzt einen neuen Eintrag `Copy Remote Path` (Icon `$(clipboard)`) — sowohl inline neben dem Item als auch im `FTP Sync`-Submenue. Der Command kopiert den absoluten Remote-Pfad (`item.remotePath`) in die System-Zwischenablage und zeigt eine kurze Bestaetigung via `showSuccessMessage`. Implementiert in `src/ui/ftpExplorer.ts` (`FtpExplorerProvider.copyRemotePath` via `vscode.env.clipboard.writeText`), registriert in `src/extension.ts activate()` zusammen mit den uebrigen FTP-Explorer-Commands (ausserhalb des Init-`try/catch`-Blocks, mit `ftpExplorer`-Null-Guard), und im `menus.view/item/context` von `package.json` an `ftpFile|ftpFolder`-Items gebunden. Hintergrund: User mussten bisher Remote-Pfade aus der Explorer-Anzeige ablesen und manuell in das `remotePath`-Feld der `.ftpsync.json` tippen — fehleranfaellig bei tiefen Pfaden oder Sonderzeichen. Mit dem neuen Eintrag ist ein Klick genug.
- **`Extract Archive` / `Extract Archive To...` im FTP-Explorer-Kontextmenue**: Rechtsklick auf eine Archiv-Datei (`.zip`, `.tar.gz`, `.tar`, `.tgz`) im FTP-Explorer bietet jetzt zwei neue Eintraege — `Extract Archive` (Icon `$(file-zip)`, inline) extrahiert in einen automatisch aus dem Parent-Dir und Archiv-Namen gebildeten Zielordner, `Extract Archive To...` (Icon `$(folder-opened)`, im `FTP Sync`-Submenue) oeffnet vorher eine InputBox fuer ein benutzerdefiniertes Remote-Ziel. Workflow: 1) Download des Archivs in ein lokales Temp-Verzeichnis, 2) lokales Entpacken (`adm-zip` fuer `.zip`, `tar.x` fuer tar/tgz), 3) rekursiver Upload jedes extrahierten Elements in das Ziel-Verzeichnis, mit Pfad-Traversal-Schutz (`..`-Segmente werden abgelehnt), abschliessend Cache-Invalidierung und Explorer-Refresh. Command-Logik in `src/ui/ftpExplorer.ts:extractRemoteArchive(item, customTargetDir?)`, registriert in `src/extension.ts activate()`, Menu-Entries in `package.json` an `viewItem =~ /ftpArchive/` gebunden (der `contextValue` fuer Archive wird in `FtpTreeItem` automatisch auf `ftpFile|ftpArchive` gesetzt, `src/ui/ftpExplorer.ts:67-69`). Neue Dependencies: `adm-zip@^0.5.16` (sync, in-memory) und `tar@^7.4.3` (async, streaming), inkl. `@types/adm-zip@^0.5.0` als devDep.
- **`Rename/Move...` und Drag-&-Drop im FTP-Explorer**: Bestehende Items koennen jetzt direkt umbenannt oder in einen anderen Ordner verschoben werden — entweder per Kontextmenue (`Rename/Move...`, Icon `$(pencil)`, InputBox prueft absoluten Pfad + kein `..`-Traversal) oder per Drag-&-Drop innerhalb des Explorers. Drag-Controller: `FtpExplorerDragAndDropController` in `src/ui/ftpExplorer.ts`, implementiert `vscode.TreeDragAndDropController<TreeItem>` mit `application/vnd.code-tree-ftpexplorer`-MIME-Type. Drop auf einen Ordner verschiebt die Quelle in diesen Ordner; Drop auf eine Datei verschiebt die Quelle in deren Parent-Ordner (VS-Code-Konvention). Verbote: kein Drop ohne Ziel, kein Drop auf sich selbst oder einen Nachfahren (Folder-in-itself-Schutz), kein Drop auf Status-Items (connection/noConfig/currentPath). Server-seitig atomar via `RemoteClient.rename()` (FTP: `RNFR`/`RNTO` durch `basic-ftp.rename`, SFTP: `ssh2-sftp-client.rename`), Cache-Invalidierung fuer Source- und Target-Parent-Dir, anschliessend `refresh()` und konsolidierte Erfolgs-/Fehler-Meldung. Command in `src/extension.ts activate()` registriert, Controller an `vscode.window.createTreeView('ftpExplorerView', { dragAndDropController })` durchgereicht.

### 🔧 Behoben

- **`Extract Archive`-Menu fehlt trotz registriertem Command**: Die `ftpSync.extractRemoteArchive`- und `ftpSync.extractRemoteArchiveTo`-Commands waren in `src/extension.ts activate()` per `vscode.commands.registerCommand(...)` registriert, aber in `package.json` weder im `commands`-Array deklariert noch in `menus.view/item.context` an den `ftpArchive`-contextValue gebunden. Folge: kein Rechtsklick-Eintrag auf Archiv-Dateien, und der Command war nur via Command-Palette erreichbar (zudem ohne Titel, da kein `package.json`-Eintrag). Fix in `package.json`: beide Commands im `commands`-Array mit Titeln/Icons aufgenommen, dazu drei Menu-Entries (`inline@4` und `ftpSync@4`/`ftpSync@5`) mit `when: view == ftpExplorerView && viewItem =~ /ftpArchive/`.
- **`command 'ftpSync.connect' not found` bei FTP-Explorer-Init-Fehler**: Die sieben FTP-Explorer-Commands (`ftpSync.connect`, `ftpSync.disconnect`, `ftpSync.refreshExplorer`, `ftpSync.navigateUp`, `ftpSync.downloadRemoteFile`, `ftpSync.deleteRemoteFile`, `ftpSync.clearCredentials`) wurden in `src/extension.ts activate()` INNERHALB des FTP-Explorer-`try/catch`-Blocks registriert. Wenn `new FtpExplorerProvider(configManager)` oder `vscode.window.createTreeView('ftpExplorerView', ...)` fehlschlug, wurde KEIN einziger dieser Commands bei VS Code angemeldet. Folge: ein Klick auf das "Not Connected"-Status-Item (Wiring `command: 'ftpSync.connect'` in `src/ui/ftpExplorer.ts`) oder den Connect-Button im Explorer-Header lieferte `command 'ftpSync.connect' not found` statt einer Diagnose. Fix in `src/extension.ts`: die sieben `vscode.commands.registerCommand(...)`-Aufrufe sind jetzt VOR den Init-`try/catch` verschoben. Jeder Handler prueft `if (!ftpExplorer)` zur Laufzeit; `ftpSync.connect` zeigt dann `showErrorMessage('FTP Sync: FTP Explorer not initialized — check the output channel for details.')`, die uebrigen Commands antworten still mit `return`. Der Init-`try/catch` umfasst jetzt nur noch Provider-Konstruktor + `createTreeView` — `ftpExplorer` bleibt bei Fehlschlag `undefined`, die registrierten Commands liefern aber eine sichtbare Diagnose. Die v2.0.2-Aenderung schuetzte bereits die `CommandHandler`-Commands vor diesem Regression; v2.0.4 schliesst die FTP-Explorer-Commands mit derselben Begruendung nach.
- **`Cannot find module 'asn1'` beim Extension-Start**: `ssh2/lib/protocol/keyParser.js:20-21` erfordert `asn1` und `bcrypt-pbkdf` beim Modul-Load (transitive deps von `ssh2@^1.15.0`). Da `ssh2` in `esbuild.config.mjs` als `external` markiert ist (wegen nativer `cpu-features`-Binding), kann esbuild diese pure-JS-Transitives nicht selbst in `out/extension.js` buendeln — sie mussten als Runtime-Files in der VSIX mitgeliefert werden. Das `.vscodeignore` whitelisted jedoch nur `ssh2/lib/*` + `cpu-features`, sodass `asn1`, `bcrypt-pbkdf`, `safer-buffer` (asn1's dep) und `tweetnacl` (bcrypt-pbkdf's dep) im VSIX fehlten. Folge: `out/extension.js` scheiterte beim ersten `require('ssh2')` mit `Cannot find module 'asn1'` in der Extension-Host-Konsole, **keine** `ftpSync.*`-Commands wurden registriert, und der User sah im Output-Channel die kryptische Loader-Exception ohne sichtbare Diagnose. Fix in `.vscodeignore`: die vier transitiven JS-Packages sind jetzt explizit ge-whitelistet (analog zum bestehenden `ssh2/lib/*`-Pattern). Extension-Aktivierung laeuft jetzt sauber durch, CommandHandler + FTP-Explorer-Commands werden registriert, anschliessendes Connect funktioniert.

## [2.0.3] - 2026-08-20

### � Behoben

- **Watcher feuert, aber Uploads passieren nicht — Global-Slot-Leak in `ConnectionPool.connect()`**: Der `globalConnectionManager`-Slot wurde beim ersten Connect-Fehler NUR im 530-Rate-Limit-Zweig freigegeben. Bei jedem anderen Fehler (ECONNREFUSED, ETIMEDOUT, falsche Credentials, TLS-Handshake-Fehler) blieb `hasSlot = true`, der Global-Slot war permanent geleakt, und nach spätestens 2 Fehlversuchen (`maxGlobalConnections = 2`) blockierte sich der ConnectionPool selbst — `acquireSlot()` wartete 120 s in der Queue, Uploads hingen, und der User sah das irrefuehrende Bild "Watcher laeuft, aber Transfer findet nicht statt". Fix in `src/core/connectionPool.ts`: `releaseSlot()` wird jetzt IMMER aufgerufen, sobald `connect()` fehlschlaegt — unabhaengig vom Fehlertyp. Klassifizierung (530 vs. anderer Fehler) bleibt unveraendert und beeinflusst nur `health` und Rate-Limit-Timestamp.
- **`FileWatcher.start()` race-safe**: Vor v2.0.3 konnte `start()` zwei Mal kurz nacheinander aufgerufen werden (z.B. `autoStartUploadOnSaveWatchers` plus ein spontaner `getOrCreateWatcher` durch einen fruehen Save-Event), bevor `isRunning = true` gesetzt war — Folge waren doppelte FileSystemWatcher-Registrierungen, doppelte Event-Handler und doppelte Polling-Loops. Fix in `src/core/fileWatcher.ts`: `startPromise`-Cache teilt parallele Aufrufer dasselbe Promise; `stop()` loescht den Cache, damit ein spaeteres `start()` wieder frisch initialisiert.
- **`getOrCreateWatcher` startet den FileWatcher jetzt selbst**: Vor v2.0.3 wurde der `FileWatcher` zwar in `this.watchers` eingetragen, aber `watcher.start()` wurde NICHT aufgerufen. Wenn `handleDocumentSave` (Ctrl+S) vor `autoStartUploadOnSaveWatchers` lief — z.B. weil der User direkt nach Workspace-Open speicherte — blieb der FileSystemWatcher unregistriert. `autoStartUploadOnSaveWatchers` uebersprang den Eintrag per `this.watchers.has(...)`-Check, KI-Agent-Writes (Cursor/Cline/git apply) wurden stillschweigend nicht hochgeladen, manueller Ctrl+S-Upload blieb funktional. Fix in `src/commands/commandHandler.ts`: `getOrCreateWatcher` ruft jetzt `await watcher.start()` auf, BEVOR der Watcher in `this.watchers` landet. Bei Fehlschlag bleibt der unstarted Watcher draussen, damit `autoStartUploadOnSaveWatchers` beim Retry den Start selbst uebernehmen kann. Race-Safety ist durch den `startPromise`-Cache in `FileWatcher` garantiert.

## [2.0.2] - 2026-07-15

### 🔧 Behoben

- **`ftpSync.createConfig` Button dedupliziert**: Der FTP-Explorer zeigt jetzt bei fehlenden Profilen nur noch **einen** Button "No configuration found — Click to create" (das `NoConfigItem` TreeItem mit `command: 'ftpSync.createConfig'`). Vorher waren zwei Render-Pfade parallel aktiv: `package.json` `viewsWelcome` mit Markdown-Link UND die ungenutzte `NoConfigItem`-Klasse. `viewsWelcome` wurde komplett entfernt, dafuer gibt `FtpExplorerProvider.getChildren()` jetzt `[new NoConfigItem()]` zurueck wenn `!configManager.hasProfiles()`. Die `NoConfigItem.contextValue = 'noConfig'` sorgt dafuer, dass `ftpSync.downloadRemoteFile` / `deleteRemoteFile` nicht versehentlich auf dem Item geriggert werden (`when: viewItem =~ /ftpFile|ftpFolder/`).
- **`commandHandler.createConfig` hat eine letzte Verteidigungslinie**: Der Aufruf `await this.configManager.createConfig(folderPath)` ist jetzt in einen `try/catch` gewrapped. Selbst wenn `configManager.createConfig` synchron wirft (z.B. ein Bug in der Pfad-Aufloesung vor dem ersten internen try/catch), sieht der User jetzt eine sichtbare Fehlermeldung statt Silent-Fail. `Logger.info`/`Logger.success` markieren Anfang, Delegation und Ende des Pfads im Output-Channel fuer eine schnellere Diagnose.
- **`CommandHandler`-Commands im Production-Bundle**: In v2.0.1 fehlten im Production-Bundle (`out/extension.js`) mehrere Commands — `ftpSync.createConfig`, `ftpSync.uploadFile`, `ftpSync.startWatcher` und 4 weitere aus `CommandHandler.registerCommands()`. Ursache: zwischen esbuild-Bundle und `vsce package` lief nochmal `npm run test:unit`, das `npm run compile` triggert und `out/extension.js` wieder mit dem 9-KB-tsc-Output ueberschreibt. v2.0.2 fuehrt einen `verify:bundle`-Schutz ein: `npm run package` prueft jetzt explizit, dass `out/extension.js` mindestens 50 KB hat, bevor `vsce package` startet. Bei einem veralteten Bundle bricht das Packaging mit einer klaren Fehlermeldung ab.
- **FTP-Explorer Init in eigenem try/catch**: `extension.ts activate()` umschliesst jetzt die FTP-Explorer-Initialisierung (Konstruktor + `createTreeView` + Command-Registrierung) in einem separaten try/catch. Ein Fehler beim TreeView-Aufbau blockiert nicht mehr die bereits registrierten CommandHandler-Commands. Bei einem Fehler wird `Logger.error` + `showErrorMessage` mit der genauen Fehlermeldung aufgerufen — der User sieht eine sichtbare Diagnose statt des kryptischen "There is no data provider registered that can provide view data." aus VS Code.
- **Saubere Single-Installation**: Die v2.0.1-VSIX hatte bei einigen Usern eine parallel laufende aeltere 1.x-Installation, die ebenfalls Welcome-Views registrierte. v2.0.2 installiert sauber ohne Co-Existenz.

## [2.0.1] - 2026-07-15

### 🔧 Behoben

- **FileSystemWatcher Auto-Start fuer `uploadOnSave`-Profile**: `commandHandler.autoStartUploadOnSaveWatchers()` in `src/commands/commandHandler.ts` wird jetzt in `extension.ts activate()` direkt nach `autoStart()` aufgerufen und startet den FileSystemWatcher automatisch fuer jedes Profil mit `uploadOnSave: true || (watcher.enabled && watcher.autoUpload)`. Vorher musste der User nach jedem Workspace-Open `ftpSync.startWatcher` manuell aufrufen, weil `FileWatcher.start()` zwar korrekt registrierte, aber nur ueber den manuellen Pfad erreichbar war. Folge: KI-Agent-Writes (Cursor, Cline, Continue, `git apply`) wurden nicht hochgeladen, weil `onDidSaveTextDocument` externe Schreibvorgaenge nicht sieht. Idempotent — mehrfache Aufrufe und nachtraegliches `ftpSync.startWatcher` blockieren sich nicht. `awaitWriteFinish: { stability: 500 }` wurde explizit DEAKTIVIERT: bei langlaufenden KI-Refactorings (1-3 s kontinuierliches Schreiben) wuerde der VS-Code-Timer staendig zurueckgesetzt und nie feuern — der eigene Debounce (`debounceMs = 500`) in `handleFileChange` collapse-t die nativ feuernden Events korrekt.
- **Defensive Activation-Blockaden**: `commandHandler.autoStartUploadOnSaveWatchers()` ist in `extension.ts activate()` in einen `try/catch` gewrapped — ein Fehler beim Auto-Start kann NIE die bereits registrierten Commands blockieren. Commands wie `ftpSync.createConfig` und `ftpSync.connect` werden in `registerCommands()` ZUERST registriert, BEVOR irgendwelche Auto-Start-Logik laeuft. `Logger.info(...)` nach `registerCommands()` loggt explizit die Anzahl der registrierten Commands fuer eine schnelle Diagnose bei zukuenftigen Cache-Problemen.

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
- **File-Watcher erkennt KI-Agent-Writes**: Profile mit `uploadOnSave: true` aktivieren jetzt auch den FileSystemWatcher — vorher griff nur `onDidSaveTextDocument`, was von externen Tools (Cursor, Cline, Continue, git apply) umgangen wird, die direkt auf Disk schreiben. Per-Profil-Filter in `handleFileChange` stellt sicher, dass manuell-nur-Profile (`uploadOnSave: false && autoUpload: false`) trotzdem nicht versehentlich hochgeladen werden.
- **File-Watcher Auto-Start fuer `uploadOnSave`-Profile**: Der vorherige Patch hatte `FileWatcher.start()` so erweitert, dass es den FileSystemWatcher registriert — aber `start()` lief nur, wenn der User `ftpSync.startWatcher` manuell aufrief oder `ftpSync.autoStartWatcher: true` gesetzt hatte (Default `false`). Das bedeutet: bei einem frischen Workspace-Open wurden KI-Writes NICHT hochgeladen, bis der User explizit startete. Neue Methode `commandHandler.autoStartUploadOnSaveWatchers()` in `src/commands/commandHandler.ts` wird jetzt in `extension.ts activate()` direkt nach `autoStart()` aufgerufen und startet den FileSystemWatcher automatisch fuer jedes Profil mit `uploadOnSave: true || (watcher.enabled && watcher.autoUpload)`. Idempotent — mehrfache Aufrufe und nachtraegliches `ftpSync.startWatcher` (manuell) blockieren sich nicht. `awaitWriteFinish: { stability: 500 }` wurde explizit DEAKTIVIERT: bei langlaufenden KI-Refactorings (1-3 s kontinuierliches Schreiben) wuerde der VS-Code-Timer staendig zurueckgesetzt und nie feuern — der eigene Debounce (`debounceMs = 500`) in `handleFileChange` collapse-t die nativ feuernden Events korrekt.
- **esbuild-Bundling eingefuehrt**: `esbuild.config.mjs` buendelt `src/extension.ts` zusammen mit allen JS-basierten Runtime-Deps (`basic-ftp`, `ignore`, `ssh2-sftp-client`, ...) in eine einzige `out/extension.js`-Datei (181 KB minified). Native `ssh2`-Module bleiben extern. VSIX ist jetzt 605 KB / 34 Dateien gross (vorher 5.7 MB / 547 Dateien). Build-Pipeline: `npm run compile` macht tsc fuer Dev + Tests, `vscode:prepublish` ruft zusaetzlich esbuild auf, `npm run package` packt.

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
