# Phase 2: Packaged runtime storage

Lifecycle: Planned

## Required outcome

The source application and packaged Electron application use explicit,
writable, persistent locations for mutable state on Windows and Linux.
Immutable packaged assets are resolved from the installed application
resources. Runtime behavior does not depend on writing inside an ASAR archive
or the source tree.

## Dependencies

Phase 1 defines the filesystem authority and process boundaries that this
phase preserves. Phase 1 exit conditions shall pass before runtime storage is
moved.

## Ownership

- `electron/main.mjs` owns packaged-path discovery and passes resolved runtime
  paths into daemon construction.
- `lib/database.mjs` owns the data-directory contract, SQLite location, and
  provider-credential key material.
- `lib/model-bootstrap.mjs` and `lib/voice-runtime.mjs` own model and download
  paths.
- `lib/agents/registry.mjs` owns mutable agent-profile storage.
- `scripts/package-desktop.mjs` owns packaged immutable resources and the ASAR
  boundary.
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
Import-time constants shall not determine packaged writable paths.

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

### P2-R03: Packaged execution defaults

Electron main shall derive packaged mutable paths from Electron's per-user
application-data location. The packaged application shall use a JARVISvX-owned
subdirectory and shall create required child directories before starting the
daemon.

Packaged immutable files shall resolve from `process.resourcesPath` or an
equivalent Electron resource path. The application shall never open a writable
database, temporary download, model installation target, lock, discovery file,
or mutable agent configuration beneath `app.asar`.

Desktop packaging shall support Windows x64 and Linux x64 from explicit target
configuration rather than a fixed operating-system value. Each target shall
use its native icon and include the native runtime dependencies required by
Electron, ONNX, and voice processing.

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

The tracked `.jarvis/agents.json` file is legacy migration input for source
installations. The first runtime that does not yet have `agentConfigPath` shall
validate and import its overrides once. Packaged applications shall not ship
this legacy file as executable configuration; packaging shall exclude
`.jarvis/` after the migration path exists.

### P2-R06: Provider credential key persistence

Provider credential encryption shall use a non-empty `JARVIS_KEY_SALT` when
configured. Otherwise it shall derive from stable key material at
`<dataRoot>/provider.key`. Database construction shall receive the same
resolved `dataRoot` that owns the fallback file. Packaged execution shall use
the corresponding file beneath the packaged `dataRoot` when the environment
override is empty.

The key-material file shall be created with owner-only permissions where the
platform supports them and shall never be logged, embedded in discovery, or
packaged as an immutable seed. Migration and backup behavior shall treat the
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

### P2-R08: Packaged startup state

The packaged host shall initialize paths before importing or constructing
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
- relevant database, migration, agent-runtime, voice, and packaging tests

## Implementation sequence

1. Define a runtime path-set constructor with source and packaged resolution
   tests.
2. Inject the path set into database, provider-key derivation, daemon, model,
   voice, Electron profile, and agent-registry construction.
3. Move mutable agent configuration to `agentConfigPath` and implement the
   one-time merge or migration from tracked seed data.
4. Align voice asset serving and TTS worker startup with `modelRoot`.
5. Align ASAR packaging rules with immutable resources and make the desktop
   packaging target explicit for Windows x64 and Linux x64.
6. Migrate and validate SQLite, provider key material, and agent overrides
   before any destination database or agent file is opened.
7. Replace README statements that all artifacts remain in the repository and
   that packaged execution avoids per-user application data. Document source
   and packaged layouts separately, including the SQLite path, daemon lock and
   discovery files, provider key material, `agentConfigPath`, logs, crash
   reports, session data, models, and temporary downloads.
8. Add an ADR defining mutable and immutable runtime storage ownership.

## Verification

Path and migration tests shall use temporary explicit roots and prove that
SQLite, file-backed key material, lock/discovery state, models, and agent
overrides land in their assigned locations. One credential round trip shall
cover both file-backed and environment-backed key material.

Confirm the packaged path resolution by constructing the packaged path set
against a temporary application-data directory, and confirm the Windows x64 and
Linux x64 targets by inspecting the packaging configuration. Building and
launching the native package on each platform belongs to the Phase 7 platform
check, which verifies these paths on the real artifact.

```text
npm run lint
```

## Exit conditions

Phase 2 is complete only when:

- mutable state uses the resolved path set outside `app.asar`;
- SQLite and its effective key material survive migration and restart;
- agent edits persist only to `agentConfigPath`;
- migration conflicts follow the defined decision path;
- the packaging configuration names Windows x64 and Linux x64 targets; and
- the focused path and migration checks pass.
