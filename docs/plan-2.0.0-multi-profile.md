# Implementation Plan — 2.0.0 (Multi-Profile)

Plan aus der Grilling-Session vom 2026-07-02. Noch nicht ausgeführt — dient als Referenz für die Implementierungsphase.

## Zielsetzung

Top-Level-Shape-Wechsel: vom implizit-einzelnen Config-Objekt zu einem expliziten `profiles`-Array, sodass:

- Bidirektionaler Sync als zwei Profile in derselben Datei ausgedrückt werden kann (siehe ADR-0003).
- Das Plugin pro Workspace mehrere Server bedienen kann.
- `name` zur Pflichtangabe wird (Identifikation mehrerer Profile).

Begleitend: `concurrency`-Feld entfernen (war eine Lüge — der Wert wurde hart auf 1 geklemmt), und die drei Retry-/Serialisierungs-Schichten mit JSDoc-Verträgen dokumentieren (siehe ADR-0001).

## Migrationsstrategie

Legacy-Configs (flaches Objekt ohne `profiles`-Key) werden beim Laden **stillschweigend** zu `{ profiles: [<objekt>] }` migriert. Kein Hinweis an den User, kein Backup-File. Pflichtfelder für die Migration:
- `name` wird — falls nicht vorhanden — auf einen Default gesetzt (z.B. `"default"` für genau ein migriertes Profil).

## Scope (was sich ändert)

| Datei | Änderung |
|---|---|
| `schemas/ftpsync.schema.json` | Top-Level `{ profiles: [Profile] }`. `name` → `required`. Neues `direction: enum` (Default `localToRemote`). `concurrency` raus. Legacy-Fallback im `description`. |
| `src/types/config.ts` | `FtpSyncProfile` (statt `FtpSyncConfig`). `FtpSyncConfigFile = { profiles: FtpSyncProfile[] }`. `mergeProfileWithDefaults(profile)`. `migrateLegacyConfig(obj)`. `DEFAULT_PROFILE` ohne `concurrency`. |
| `src/types/index.ts` | Re-exports anpassen. |
| `src/core/configManager.ts` | Lädt `profiles`-Array. Auto-Migration wenn Top-Level kein `profiles` hat. `getProfileForUri(uri)` und `getAllProfiles(): Map<profileId, FtpSyncProfile>`. `hasProfiles()`. File-Watcher bleibt auf gleicher Datei. |
| `src/commands/commandHandler.ts` | `getOrCreateWatcher(workspacePath)` bleibt als Entry-Point; Internes Mapping Profile → ConnectionPool wird aufgebaut. Upload/Download-Commands wählen Profil per URI. |
| `src/core/connectionPool.ts` | **Nur JSDoc.** Vertrag: Slot-Management (delegiert an `globalConnectionManager`), Operation-Mutex, Reconnect+Retry, Failure-Klassifikation. Verweis ADR-0001. |
| `src/core/operationQueue.ts` | `concurrency`-Parameter aus Konstruktor + `Math.min(clamp)` raus. Konstante `DEFAULT_CONCURRENCY = 1`. JSDoc: Reihenfolge-Scheduling, sequenziell. Verweis ADR-0001. |
| `src/core/fileWatcher.ts` | Klassenname bleibt. JSDoc oben: "Watcher pro Workspace Folder. Wertet Trigger aus und leitet Transfers an Connection Pools der registrierten Profile weiter." Hinweis auf zukünftige Tombstone-Integration. |
| `package.json` | Version 2.0.0. Schema-URL bleibt. Kein zusätzlicher `jsonValidation`-Eintrag nötig (das Schema matcht Top-Level). |
| `CHANGELOG.md` | Neuer Eintrag für 2.0.0 mit den oben genannten Änderungen. |

## Was sich NICHT ändert

- `RemoteClient` / `SftpClientWrapper` / `FtpClient` — kein Code-Touch.
- `Watcher` (heutiger `FileWatcher`) — Klassenname und Methodensignaturen bleiben.
- `FtpExplorerProvider` — behält seinen eigenen unabhängigen `RemoteClient` (heutiges Verhalten; in der Grilling-Runde explizit als "geteilt, aber Concurrency entkoppelt" bestätigt).
- Drei Retry-Schichten — kein Refactoring, ausschließlich Doku (ADR-0001).
- Kein neues Feature: die 2.0.0-Änderung ist primär ein Modell-Cutover. Bidirektionalität, Tombstones, Konflikterkennung sind Folge-Releases und werden in dieser Iteration nicht implementiert.

## Backward Compatibility

- Konfig-Datei-Format: alte flache Form lädt weiter (Migration im `ConfigManager`).
- Kommandos, IDs, Settings: alle unverändert.
- Marketplace-Version 2.0.0 — Major-Bump signalisiert den Modell-Wechsel.

## Verifikation

- `npm run compile` muss sauber durchlaufen.
- `npm run lint` muss sauber durchlaufen.
- Manuelle Stichprobe in F5-Extension-Host: alte `.ftpsync.json` laden, neue Config (Multi-Profile) anlegen, Upload und Watcher testen.

## Folge-Arbeit (nicht in 2.0.0)

- Tombstone-Implementierung in `context.globalState` (ADR-0002).
- Bidirektionaler Sync (zweites Profil pro Workspace mit Spiegel-Logik).
- `FtpExplorerProvider`-Status für mehrere Profile (heute zeigt er nur einen).
- Tests: bisher keine Tests vorhanden; `vscode-test`-Setup ist konfiguriert, sollte aber im selben Wurf nicht angefasst werden.
