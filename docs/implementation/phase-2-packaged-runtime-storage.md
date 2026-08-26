# Phase 2: Runtime storage

Lifecycle: Planned

## Required outcome

The application runs from a repository clone on Windows and Linux and keeps
every piece of mutable state in an explicit, writable, relocatable location.
One resolved path set owns those locations, so moving the data root moves the
database, credential key material, models, and agent configuration together.
No runtime file is written inside the application's own install tree.

## Dependencies

Phase 1 defines the filesystem authority and process boundaries that this
phase preserves. Phase 1 exit conditions shall pass before runtime storage is
moved.

## Ownership

- `electron/main.mjs` owns runtime-path discovery and passes the resolved path
  set into daemon construction.
- `lib/database.mjs` owns the data-directory contract, SQLite location, and
  provider-credential key material.
- `lib/model-bootstrap.mjs` and `lib/voice-runtime.mjs` own model and download
  paths.
- `lib/agents/registry.mjs` owns mutable agent-profile storage.
- `.env.example`, `README.md`, and platform quick-start guides own the operator
  configuration contract.

## Requirements

### P2-R01: Runtime path set

Daemon construction shall receive a resolved runtime path set containing at
least:

- `dataRoot`: SQLite, provider-credential key material, daemon discovery, and
  daemon lock state;
- `cacheRoot`: replaceable download and temporary state;
- `modelRoot`: installed wake, STT, and TTS model bundles;
- `profileRoot`: Electron browser profile state; and
- `sessionRoot`: replaceable Electron session state;
- `logRoot`: Electron and daemon logs;
- `crashRoot`: Electron crash reports; and
- `agentConfigPath`: mutable agent-profile overrides.

Core modules shall consume this path set or explicit constructor options.
Import-time constants shall not determine writable paths.

### P2-R02: Source execution defaults

Source execution shall preserve repository-local defaults for development:

| State | Source default |
|---|---|
| Data | `<project>/data` |
| Provider credential key material | `JARVIS_KEY_SALT`, otherwise `<project>/data/provider.key` |
| Cache | `<project>/cache` |
| Models | `<project>/models` |
| Electron profile | `<project>/data/electron-profile` |
| Electron session | `<project>/cache/electron/session` |
| Logs | `<project>/cache/electron/logs` |
| Crash reports | `<project>/cache/electron/crash-dumps` |
| Agent overrides | `<project>/data/agents.json` |

Environment variables documented in `.env.example` may override these paths.
The path-set constructor shall preserve and subsume the existing
`JARVIS_MODEL_DIR` and `JARVIS_TEMP_DIR` overrides alongside
`JARVIS_DATA_DIR`; these names shall be documented rather than duplicated by a
second override scheme. Each override is resolved once and passed to all
consumers. Provider encryption shall preserve the documented
`JARVIS_KEY_SALT` override independently of path resolution.

### P2-R03: Install-tree separation

Every writable location shall come from the resolved path set. The application
shall never open a writable database, temporary download, model installation
target, lock, discovery file, credential key file, or mutable agent
configuration inside its own install tree, and shall create required child
directories before the daemon starts.

The desktop host shall resolve the same path set on Windows and Linux from a
repository clone. Packaging the application for distribution is outside this
program; `scripts/package-desktop.mjs` may hold target configuration, but no
phase gates on building or launching a packaged artifact.

### P2-R04: Model storage and serving

Voice-model download targets and the daemon's voice-asset routes shall use the
same resolved `modelRoot`. Electron TTS workers shall receive absolute model
paths from Electron main. Model existence checks, downloads, HTTP serving, and
worker loading shall therefore observe one model installation.

Package configuration shall include only immutable bootstrap assets required
at installation time. Downloaded models remain in writable runtime storage and
survive application upgrades.

### P2-R05: Agent profile persistence

Built-in agent definitions shall remain immutable defaults in
`lib/agents/registry.mjs`. User changes shall be stored as overrides under
`agentConfigPath` and merged by the agent registry. Normal UI editing shall not
modify a tracked source file.

These two layers are the whole system: code defaults, and one override file
that moves with the data root. There is no seed file, no workspace-scoped
profile source, and no adoption step. A start that changes nothing writes no
override file; the first edit creates it.

### P2-R06: Provider credential key persistence

Provider credential encryption shall use a non-empty `JARVIS_KEY_SALT` when
configured. Otherwise it shall derive from stable key material at
`<dataRoot>/provider.key`. Database construction shall receive the same
resolved `dataRoot` that owns the fallback file, so a relocated data root moves
the key material with the database.

The key-material file shall be created with owner-only permissions where the
platform supports them and shall never be logged, embedded in discovery, or
committed as seed data. Migration and backup behavior shall treat the
SQLite database and its effective environment- or file-backed key material as
one recoverable unit. Environment-backed material remains external
configuration; file-backed material migrates with SQLite.

### P2-R07: Migration and conflict behavior

When the resolved destination differs from a legacy location, `startDaemon()`
shall own one migration invocation before opening SQLite or agent
configuration. Electron passes its interactive conflict callback into daemon
startup; CLI and headless callers pass the documented non-interactive policy.
Electron main shall not run a second pre-daemon migration. Migration operates
on explicit absolute paths and preserves the source until the destination has
been validated.

An existing destination invokes the defined import, overwrite, or keep-current
decision path. Headless startup returns a typed conflict instead of selecting a
destructive action implicitly. Migration validation shall verify SQLite and
its effective key material together. A file-backed key shall publish with the
database; an environment-backed key shall be available before the destination
database opens.

### P2-R08: Startup path state

The desktop host shall initialize paths before importing or constructing
modules that open runtime files. A startup failure shall identify the logical
path (`dataRoot`, `modelRoot`, and so on), the resolved location, and the
operation that failed without exposing provider credentials or daemon tokens.

## Implementation targets

- `electron/main.mjs`
- `lib/daemon.mjs`
- `lib/application.mjs`
- `lib/database.mjs`
- `lib/data-migration.mjs`
- `lib/model-bootstrap.mjs`
- `lib/voice-runtime.mjs`
- `lib/agents/registry.mjs`
- `scripts/package-desktop.mjs`
- `package.json`
- `.gitignore`
- `.env.example`
- `README.md`
- `docs/QuickStart-windows.md`
- `docs/QuickStart-linux.md`
- relevant database, migration, agent-runtime, and voice tests

## Implementation sequence

1. Define a runtime path-set constructor with resolution tests for the default
   root and for a relocated data root.
2. Inject the path set into database, provider-key derivation, daemon, model,
   voice, Electron profile, and agent-registry construction.
3. Move mutable agent configuration to `agentConfigPath` and implement the
   one-time merge or migration from tracked seed data.
4. Align voice asset serving and TTS worker startup with `modelRoot`.
5. Migrate and validate SQLite, provider key material, and agent overrides
   before any destination database or agent file is opened.
6. Replace README statements that all artifacts remain in the repository.
   Document the default layout and what a relocated data root moves, including
   the SQLite path, daemon lock and discovery files, provider key material,
   `agentConfigPath`, logs, crash reports, session data, models, and temporary
   downloads.
7. Add an ADR defining runtime storage ownership and the relocatable data root.

## Verification

Path and migration tests shall use temporary explicit roots and prove that
SQLite, file-backed key material, lock/discovery state, models, and agent
overrides land in their assigned locations. One credential round trip shall
cover both file-backed and environment-backed key material.

Start the daemon from a clone against a relocated data root and confirm that no
runtime file appears inside the install tree. Confirming the same layout on
Windows and Linux belongs to the Phase 7 platform check.

```text
npm run lint
```

## Exit conditions

Phase 2 is complete only when:

- every writable location comes from the resolved path set, and none resolves
  inside the install tree;
- SQLite and its effective key material survive migration and restart;
- agent edits persist only to `agentConfigPath`;
- migration conflicts follow the defined decision path; and
- the focused path and migration checks pass.
