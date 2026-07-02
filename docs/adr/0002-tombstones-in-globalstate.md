# Tombstones live in the extension's globalState

Deleted-file tombstones are persisted in VS Code's `context.globalState` rather than in workspace files or remote metadata files.

**Why globalState**: tombstones are an implementation detail of the deletion-protection mechanism; they must not be committed to the repo, must not pollute the remote server, and must be portable across multiple workspaces that share the same server connection. `context.globalState` satisfies all three constraints while remaining invisible to the user.

**Considered options**: Workspace-local file such as `.vscode/.ftpsync.tombstones.json` (rejected — pollutes repos, would need `.gitignore` exceptions per workspace), remote tombstone file (rejected — adds roundtrips and leaves server-side litter).

**Consequences**: When the extension is uninstalled or its global state cleared, all tombstones are lost — a future bidirectional sync would re-delete files that were previously tombstoned. Users who rely on long deletion-protection windows must be informed of this limitation. The first user-facing documentation that mentions tombstones should call out the globalState location and its implications.