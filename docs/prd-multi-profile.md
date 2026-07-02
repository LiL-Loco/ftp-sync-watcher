# Multi-Profile Support for FTP Sync Watcher

## Problem Statement

FTP Sync Watcher today forces every workspace into a single Profile (called "Config" internally). Three concrete consequences for users:

- Bidirectional file synchronisation is impossible: a single Profile can only express one `Direction`. Users who want to publish to a server *and* pull assets back have no model to express the second case without inventing a sibling config file in another folder.
- Users with multiple servers (production, staging, design sandbox) cannot reach them from the same workspace without juggling separate workspace folders — the plugin's reach ends at one server per workspace.
- The Promise chain inside `ConnectionPool` is invisible to contributors. Future attempts to "simplify the retry logic" risk re-introducing the `basic-ftp` "User launched a task while another one is still running" regression, the FTP 530 "max connections" error path, or the `Ctrl+S`-spam duplicate-upload problem (see [ADR-0001](../adr/0001-three-retry-layers.md)). None of these is documented anywhere reachable from the code.

## Solution

Adopt the **Profile** as the canonical unit of sync. Allow any number of Profiles inside a single workspace's config file. Auto-migrate the legacy single-config format silently on load. Drop the unused `concurrency` config field that was being clamped to `1` at runtime. Codify the responsibilities of the three retry/serialisation layers in JSDoc so they can't be eroded by accident.

This is a *foundation* release, not the bidirectional feature itself. Bidirectional mirroring, Tombstone deletion protection, and conflict detection are explicitly deferred (see Out of Scope).

## User Stories

### Legacy compatibility

1. As an **existing user**, I open a workspace that already has a `.ftpsync.json` after upgrading to 2.0.0, so that my uploads and watcher continue to work without editing the file by hand.
2. As an **existing user**, I see no popup, modal, or warning when the extension loads my legacy config, so that the upgrade feels invisible.
3. As an **existing user**, when I open my migrated config in the JSON editor, I see the same values I wrote before, only nested inside a `profiles` array under a single derived name, so that nothing in my mental model of the file is invalidated.
4. As an **existing user without a `name` field** in my old config, the migration assigns a deterministic default name like `default`, so that the migrated profile is identifiable in the status bar and logs.
5. As an **existing user**, I can keep using `Ctrl+S`, the watcher, the FTP Explorer, and all existing commands exactly as before, so that the upgrade introduces no new muscle-memory work.

### New config authoring

6. As a **new user**, when I run `FTP Sync: Create Configuration File`, the generated template scaffolds a top-level `profiles` array with one example Profile, so that I learn the new shape from a working example rather than guessing.
7. As a **new user**, the generated template carries inline, German-language comments explaining every Profile field, so that I do not need to leave VS Code to understand the schema.
8. As a **user authoring a new config**, I receive IntelliSense (autocomplete and validation) when I add a new Profile entry, so that I get the schema's correctness feedback inline.
9. As a **user editing a config**, I cannot save a Profile without a `name` field — the JSON schema validation surfaces the error in the editor, so that I cannot silently produce an unidentifiable Profile.

### Multi-profile support

10. As a **developer with production and staging servers**, I add a second Profile to my workspace config, so that I can sync to either from the same workspace without context-switching folders.
11. As a **user with multiple Profiles**, the status bar shows which Profile(s) are currently watching, so that I know which server an upload will go to without opening the config.
12. As a **user with multiple Profiles**, the Activity Bar tree view (FTP Explorer) labels each Profile distinctly in the connection header, so that I do not confuse two connected servers when both are open.
13. As a **user with multiple Profiles**, the Output Channel log lines tag each operation with the Profile name, so that I can trace which Profile triggered a given transfer.
14. As a **user with multiple Profiles**, `FTP Sync: Toggle Watcher` still starts/stops all Profiles together (the existing muscle-memory command stays predictable), so that I do not have to remember which Profile is currently running.

### Direction field

15. As a **user**, every new Profile defaults to `direction: "localToRemote"` so that the simplest case continues to work without configuration.
16. As a **user preparing for future bidirectional sync**, I can set `direction: "remoteToLocal"` on a Profile today without runtime errors, so that my config is forward-compatible when the mirroring engine lands in 2.x.
17. As a **user**, I see `direction` documented in the JSON schema with descriptions for each value, so that I understand what each option means before enabling it.

### Configuration file watching

18. As a **user editing `.ftpsync.json` while the extension is running**, the in-memory Profile list updates on save without requiring a window reload, so that I can iterate quickly.
19. As a **user editing `.ftpsync.json` to add a Profile while a watcher is already running**, the new Profile is started or left idle according to its `watcher.enabled` flag and the `ftpSync.autoStartWatcher` setting, so that the watcher's lifecycle matches expectations.

### Cleanup of unused config surface

20. As a **user**, I notice that the `concurrency` field has disappeared from my config and from the JSON schema, so that I am no longer misled into believing that field has any effect.
21. As a **user migrating from a 1.x config**, the migration silently drops any `concurrency` value my old file contained, so that loading does not error on an unrecognised field.

### Documentation of internal contracts

22. As a **future contributor**, I open `ConnectionPool.ts` and read a JSDoc header that names the three responsibilities — slot acquisition delegated to `globalConnectionManager`, per-pool operation mutex, per-operation retry with classification of connection errors — and references [ADR-0001](../adr/0001-three-retry-layers.md), so that I understand why each layer exists before I propose to "simplify" it.
23. As a **future contributor**, I open `OperationQueue.ts` and read a JSDoc header that states the queue is a *sequencing* mechanism (priority + ordering) and explicitly delegates retry and connection-slot semantics to `ConnectionPool` and `globalConnectionManager`, so that I do not stack duplicate retries on top of one another.
24. As a **future contributor**, I open the Watcher class and read a JSDoc header explaining that it is one Watcher per workspace folder, dispatching transfers to the right Profile's `ConnectionPool`, so that I understand the multi-Profile fan-out.

### Marketplace / versioning

25. As a **marketplace user**, the extension version increases to 2.0.0 to mark the structural shift in config shape, so that I can identify from the version number alone that this is a model change, not a pure bug fix.
26. As a **CHANGELOG reader**, the 2.0.0 entry lists the multi-Profile support, the auto-migration, the new `direction` field, the removal of `concurrency`, and the contract documentation in plain language, so that I can plan my upgrade without reading the diff.

## Implementation Decisions

### Configuration shape

The top-level config object becomes `{ "profiles": [Profile, ...] }`. Each entry in the array is a `FtpSyncProfile`. A `FtpSyncConfigFile` container type is introduced to hold the array. The shape comes from the prototype agreed during the planning session that produced `docs/plan-2.0.0-multi-profile.md`:

```ts
type Direction = 'localToRemote' | 'remoteToLocal' | 'bidirectional'

interface FtpSyncProfile {
  name: string                  // required
  direction?: Direction         // default 'localToRemote'
  protocol: 'ftp' | 'sftp'
  host: string
  port?: number
  username: string
  password?: string
  privateKeyPath?: string
  passphrase?: string
  remotePath: string
  localPath: string
  uploadOnSave: boolean
  watcher: {
    enabled: boolean
    files: string | false
    autoUpload: boolean
    autoDelete: boolean
  }
  ignore: string[]
  useGitIgnore: boolean
  secure: boolean
  secureOptions?: { /* unchanged */ }
  timeout: number
  debug: boolean
}

interface FtpSyncConfigFile {
  profiles: FtpSyncProfile[]
}
```

- `name` becomes required on every Profile. The JSON schema's `required` list is extended accordingly so that IntelliSense rejects saves without it.
- `concurrency` is removed from the Profile, from `DEFAULT_PROFILE`, and from the JSON schema. The runtime clamp in `OperationQueue` that hid its effect is also removed; `OperationQueue` becomes a strictly sequential queue with a fixed internal concurrency constant.
- A new `direction` field is added with enum values `localToRemote | remoteToLocal | bidirectional`. The runtime only honours `localToRemote` today — selecting any other value is a no-op that does not error, so that profiles declaring a future direction are forward-compatible.

### Configuration loading

- The `ConfigManager` accepts a top-level object and detects legacy shape by the absence of a `profiles` key. If absent, the object is wrapped: `{ profiles: [<legacy>] }`, and the missing `name` is filled with a deterministic default such as `default`.
- All callers of `getConfig` / `getConfigForUri` are updated to retrieve Profiles via the new `getProfileForUri` / `getAllProfiles` lookup. Profile identity remains the absolute path of its config file.
- The config file watcher triggers a full reload on save and exposes the new Profile set to the rest of the system.

### Profile-per-ConnectionPool

- One `ConnectionPool` per Profile, not per workspace. Where today a workspace with an old single-Profile config has one pool, a workspace with N Profiles has N pools, each with its own mutex and retry budget.
- The Watcher class keeps its existing name and signature; its internal state changes from `connectionPool: ConnectionPool` to `connectionPools: Map<profileId, ConnectionPool>`. Trigger dispatch picks the pool based on the file path the trigger describes.
- The global connection slot manager remains shared across all pools in all workspaces. Its hard cap is unchanged for 2.0.0.

### UI surface

- The status bar reports a viewing-mode state plus, when multiple Profiles are loaded, a count of currently-watching Profiles. The exact rendering choice is left to implementation; the contract is "the user can always tell which Profiles are watching and how many".
- The FTP Explorer header surfaces the *currently connected* Profile when more than one is loaded, so that the user is never confused about which server the tree represents.
- Commands that previously took a Config continue to work; their internal selection picks the right Profile for the resource they are given.

### Forward compatibility

- A Profile declaring `direction: "remoteToLocal"` or `direction: "bidirectional"` does not error today. It loads, registers, but produces no transfers. This is a deliberate non-error so that users can stage their config for the next release without disabling the extension.

### Internal contract documentation

The three retry/serialisation layers keep their current behaviour (per [ADR-0001](../adr/0001-three-retry-layers.md)). Each layer gains a JSDoc header that names its sole responsibility and points at the ADR:

- `globalConnectionManager` — cross-pool slot allocation only.
- `ConnectionPool` — per-Pool operation mutex, reconnect, retry; delegates slot acquisition.
- `OperationQueue` — sequencing (priority + ordering); delegates retry and slot semantics.

No code in these three layers changes. The point is to make the contracts discoverable, not to refactor.

## Testing Decisions

### Testing seam

There is exactly one test seam for this PRD: end-to-end via `vscode-test`. The project has no existing test directory; the introduction of `vscode-test` infrastructure is itself part of this work, since launching the extension in a real VS Code instance is the only way to exercise multi-Profile selection through real commands.

### What makes a good test

- Test **observable behaviour**, not internal structure. A test must trigger something a user can trigger (a command, a file save, a config edit) and observe something a user can observe (status bar text, log line, file present on remote).
- Do not assert against private maps, internal counters, or mutex state. The behaviour under test is "the right Profile acts on the right file"; the test should verify the consequence on the remote server or the user-visible status, not the routing inside the Watcher.
- Treat the auto-migration of legacy config as observable behaviour: it is verified by reading the in-memory profile set from a public API after loading a legacy file, not by inspecting the file on disk afterwards.

### Fixtures and scenarios

The test workspace ships with a fixture `.ftpsync.json` containing two Profiles — one with `localToRemote`, one with `remoteToLocal` — pointing at a test-only local mock remote. The mock remote is a directory on the local filesystem disguised as an FTP server for the duration of the test. This avoids any external dependency and makes the suite deterministic in CI.

### Scenarios under test

1. Loading a legacy flat-object config produces exactly one Profile named `default` and uploads continue to work.
2. Loading a new shape `{ "profiles": [Profile, Profile] }` produces two Profiles and each independently responds to a save in its `localPath`.
3. Saving without a `name` field is rejected by the JSON schema in the editor (verified by inspecting the diagnostics API after a programmatic save).
4. With two Profiles loaded, the status bar shows the multi-Profile indicator; with one, it shows the single-Profile indicator.
5. A Profile declaring `direction: "remoteToLocal"` loads, registers, and produces no transfers (forward-compatibility check).

### Prior art

There is no prior test code in the repository — the only test reference in `.vscode/launch.json` (`out/test/suite/index`) does not yet resolve to any file. This PRD therefore establishes the test pattern rather than following one.

## Out of Scope

- Bidirectional mirroring engine. Profiles can declare `direction: "remoteToLocal"` or `direction: "bidirectional"` and load without error, but no transfer flow implements those directions. That work lives in a follow-on release that also introduces the Tombstone deletion-protection mechanism described in [ADR-0002](../adr/0002-tombstones-in-globalstate.md).
- Tombstone creation, expiry, and globalState wiring. The Tombstone domain term is established and the storage location is decided (the extension's `context.globalState`), but the lifecycle is not.
- Conflict detection between local and remote edits in a single direction.
- Replacement of the hard cap on global connection slots. The cap remains a code-level constant.
- Per-Profile UI for toggling, error surfacing, and statistics. Profile-aware commands are introduced minimally — one status-bar indicator, one Explorer header. Granular per-Profile user controls are a separate effort.
- Migration of `.ftpsync.json` files outside `<workspace>/.vscode/` or that use non-default filenames. The legacy-format detection only covers the path the extension already knows.
- New tests for internal helpers (`OperationQueue` priority ordering, `ConnectionPool` mutex behaviour). Per ADR-0001 these layers' contracts are documented, not unit-tested in this release; covering them risks stabilising the implementation against future change rather than the user-facing contract.

## Further Notes

- The replacement of the terms "Config" and "Connection" by the canonical term "Profile" is documented in `CONTEXT.md`. Existing internal class names (`FtpSyncConfig`, `ConfigManager`) are renamed in the implementation phase; class names of classes that user-facing commands and settings reference remain untouched for compatibility.
- [ADR-0003](../adr/0003-bidirectional-as-separate-profiles.md) is the architectural anchor for this PRD: Bidirectional sync is modelled as two Profiles, not as a single Profile with a `direction: "bidirectional"` field. This PRD does *not* ship bidirectional sync — it ships the data model and the loading mechanics that bidirectional sync will need.
- The implementation outline, including file-level scope, lives at `docs/plan-2.0.0-multi-profile.md`. The PRD supersedes the in-narrative details of that plan; the plan lives on as the implementation reference for whoever picks the work up.
- The marketplace version is bumped to `2.0.0` to mark the structural config-shape change, even though every existing user workflow continues to work. This is a deliberate signal that the model has changed.
- This release is a foundation. Future releases in the 2.x line build on it for bidirectional sync, Tombstones, and Explorer-Profile aggregation. Each future release is expected to produce its own PRD.
