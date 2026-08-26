# ADR 0004: Runtime storage ownership

Status: Accepted
Date: 2026-08-25

## Context

Every module that opened a file resolved its own location from a constant
computed at import time and anchored to the installation directory. That works
while the code and its state share a directory, but a packaged desktop build
seals the code inside `app.asar`, a read-only archive. A module that anchors to
its own source location therefore resolves writable state inside the archive.

The locations also disagreed with each other. Voice model downloads honored
`JARVIS_MODEL_DIR`, while the desktop host loaded the same models from a
hardcoded path that did not. Agent-profile edits were written relative to the
process working directory, which is not guaranteed to be anywhere in
particular. Provider-credential key material derived from the process-wide data
directory rather than the data root of the database it belonged to, so a
database opened elsewhere wrote its key somewhere else.

## Decision

`lib/runtime-paths.mjs` resolves every runtime location once, under one root.

**One set, injected.** `createRuntimePaths({ root, env })` returns a frozen set
covering `dataRoot`, `cacheRoot`, `tempRoot`, `modelRoot`, `profileRoot`,
`sessionRoot`, `logRoot`, `crashRoot`, `agentConfigPath`, and the database,
discovery, lock, and provider-key files. `startDaemon()` accepts the set and
threads it into the database, voice runtime, model bootstrap, and agent
registry. No consumer computes a writable location for itself.

**The caller owns the root.** The constructor resolves a layout under whatever
root it is given and does not decide where that root is. Source execution passes
the installation directory. `electron/main.mjs` owns packaged-path discovery and
passes the directory holding the executable, so packaged state sits beside the
application rather than inside its archive. Immutable assets — the built
renderer and the window icon — continue to resolve from the code location and
`process.resourcesPath`.

**Three overrides, resolved once.** `JARVIS_DATA_DIR`, `JARVIS_MODEL_DIR`, and
`JARVIS_TEMP_DIR` relocate their own roots. Locations derived from the data root
follow it; cache-derived locations do not. `JARVIS_KEY_SALT` remains external
configuration, independent of path resolution.

**Failure names the path.** `ensureRuntimePaths` creates every directory before
the daemon is constructed and reports the logical key, the resolved location,
and the operation that failed, rather than relocating silently.

**Key material belongs to its database.** `JarvisDatabase` carries the data root
it was constructed with and derives credential encryption from it, so
`provider.key` is written beside the database it decrypts.
`assertCredentialKeyAvailable` runs after migration: a database that stores
encrypted credentials with neither `JARVIS_KEY_SALT` nor a `provider.key` beside
it is reported before it is opened for use.

**One migration.** `startDaemon()` owns the single invocation. The desktop host
supplies an interactive conflict callback; other callers use the non-interactive
merge policy. A decision outside `import` or `overwrite` raises a typed conflict
and leaves both directories intact. The move stages beside the destination and
validates the staged tree against the source before publishing it and retiring
the source, so an interruption leaves one complete copy and re-running
converges; publication does not depend on renaming onto an existing directory,
which is not portable.

**Agent overrides are runtime state.** The registry writes to `agentConfigPath`
under the data root, and that file is the only override source; there is no seed
file beside the source tree. Desktop packaging excludes `.env`.

**Declared packaging targets.** `scripts/package-desktop.mjs` names its
platform/arch targets in a table with the icon each one uses. The host target is
selected by default; an undeclared pair is refused before packaging starts.

## Consequences

- Relocating state is a change to one resolved set, not to every module.
- A packaged build writes nothing beneath `app.asar`, and an installation
  directory that cannot be written to is reported instead of worked around.
- Model downloads, HTTP asset serving, and the desktop synthesis worker observe
  one model installation.
- A database and its file-backed key travel together, and a separation is caught
  at startup rather than surfacing as unreadable credentials later.
- Relocating a data root moves the operator's directory, contents and all; an
  interrupted move never leaves the operator without a complete copy.
- Saving an agent profile no longer modifies a tracked file, and the profile
  survives reinstalling over the source tree.
- Adding a desktop target is a table entry; building the artifacts each target
  names is a separate platform check.
