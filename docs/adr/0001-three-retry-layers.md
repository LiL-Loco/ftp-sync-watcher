# Three retry / serialisation layers are kept

We intentionally keep three layers — `globalConnectionManager` (cross-pool slot allocation), `ConnectionPool` (per-profile operation mutex, reconnect, retry), `OperationQueue` (per-watcher priority scheduling) — and document each layer's contract in JSDoc instead of consolidating them. The pathological worst case of 9× retries (3 in the queue × 3 in the pool) is accepted as a deliberate safety margin for flaky servers, not a bug.

**Why not one layer**: each layer solves a different problem that appeared at a different time — `globalConnectionManager` against the FTP server's "530 maximum connections" error, the connection-pool mutex against `basic-ftp`'s "User launched a task while another one is still running" error, the operation queue against `Ctrl+S` spam in 1.1.2. Consolidating them now would re-derive the original failures.

**Considered options**: Single retry layer with one entry point (rejected — masks the FTP- and server-specific failure modes), the current three-layer stack without explicit contracts (rejected — the surprise of 9× retries is exactly the kind of confusion this ADR is meant to kill).

**Consequences**: New contributors who propose "simplifying the retry chain" must be pointed at this ADR. Any new transfer entry point must go through `ConnectionPool.executeWithRetry` — direct `RemoteClient` calls bypass both the mutex and the slot manager.