# Bidirectional sync is expressed as two profiles

Bidirectional file synchronisation is modelled as two profiles in the same workspace config, not as a `direction: 'bidirectional'` field on a single profile. Each profile owns exactly one direction; the bidirectional use case is the composition of two unidirectional profiles.

**Why not a direction field**: a single profile with `direction: 'bidirectional'` would force every concept downstream — triggers, ignore rules, retry semantics, conflict handling — to be direction-aware in addition to being profile-aware. Splitting into two profiles keeps the profile a unidirectional unit and makes the composition explicit: two profiles that happen to share a workspace and a server.

**Considered options**: `direction: 'bidirectional'` field on a single profile (rejected — see above), two profiles with explicit pairing metadata (rejected — premature, the pairing is just "same workspace, same host, opposite directions", which falls out of the data), two profiles with separate config files (rejected — adds filesystem ceremony, breaks the single-config-per-workspace rule).

**Consequences**: `name` becomes mandatory on every profile (to distinguish "Production (push)" from "Production (pull)"). The schema's `required` list must include `name`. The status bar and explorer must be able to surface multiple profiles per workspace — the current single-status model needs to be reworked. Future work on bidirectional sync (tombstones, conflict handling) attaches to the pair of profiles, not to a single one.