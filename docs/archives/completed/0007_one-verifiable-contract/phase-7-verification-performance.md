# Phase 7: Integration and efficiency cleanup

Lifecycle: Planned

## Required outcome

The completed features work together through their public application paths.
Ordinary interaction avoids repeated provider, probe, and database work. The
project passes one final functional check on Windows and Linux.

## Dependencies

Phases 1 through 6 shall meet their functional exit conditions.

## Ownership

- `src/App.tsx` and client hooks own request deduplication and event-driven
  state updates.
- `lib/diagnostics.mjs` owns bounded probe aggregation.
- `lib/database.mjs` owns deterministic queries and necessary indexes.
- `package.json` owns lint and complete test discovery.
- `README.md` and operator guides own current user-facing behavior.

## Requirements

### P7-R01: Functional integration

Focused integration tests shall cover the boundaries most likely to hide a
false success or duplicate side effect:

- an approved and denied turn through routing and provider invocation;
- memory selection through the captured provider request;
- MCP discovery and execution through the shared dispatcher;
- agent participants through synthesis and run persistence; and
- daemon startup through writable storage and clean shutdown.

Existing focused tests satisfy this requirement when they exercise the public
application path.

### P7-R02: Request and probe efficiency

Initial desktop load may request provider health once and models once for the
effective provider. An ordinary turn shall update conversation state from its
stream events without running a provider-health sweep or a composite refresh.
Provider changes shall refresh only provider and model state; conversation
changes shall refresh only conversation state.

Equivalent concurrent refreshes shall share one in-flight request. Superseded
model and diagnostic probes shall be aborted, and stale responses shall not
replace newer state. Every network probe shall have a timeout and pass its
abort signal to the underlying request.

### P7-R03: Persistence efficiency

Queries shall include deterministic tie-breakers. Add an index only for a
repeated application query whose existing access path scans avoidable data.
Confirm each added index serves its owning query.

Further optimization is driven by a measured user-facing delay or a
demonstrated unbounded operation.

### P7-R04: Project checks

`npm test` shall discover every `test/**/*.test.mjs` file automatically with
deterministic concurrency, including `test/mcp-stdio.test.mjs`.

`npm run lint` shall check renderer TypeScript and repository JavaScript. The
JavaScript check shall cover undefined identifiers in `lib/`, `bin/`,
`electron/`, `scripts/`, and `test/` with an ESM-aware configuration.

The final platform check consists of lint, the discovered test suite, the
production build, and one desktop start and restart from a clone on Windows and
on Linux. Platform checks run natively so Electron and native dependencies match
the host operating system. Each run also confirms the Phase 2 storage contract:
runtime state resolves outside the install tree, voice assets load from
`modelRoot`, and an agent-profile edit lands in `agentConfigPath`.

### P7-R05: Documentation accuracy

README architecture and storage, quick starts, operator guides, accepted ADRs,
API names, status values, and commands shall describe the implemented system.
`AGENTS.md` shall use `docs/adr/adr-NNNN-<slug>.md` as the canonical ADR path.

Storage documentation shall identify SQLite, daemon lock and discovery files,
effective provider key material, and mutable agent configuration, and shall say
which of them a relocated data root moves. Seed data shall name the actual React and authored-CSS
frontend stack.

## Implementation targets

- `src/App.tsx`
- `src/api.ts`
- `src/hooks/`
- `lib/diagnostics.mjs`
- `lib/database.mjs`
- focused integration tests under `test/`
- `package.json`
- lint configuration
- `scripts/package-desktop.mjs`
- `AGENTS.md`
- `README.md`
- operator and quick-start guides

## Implementation sequence

1. Connect the focused integration tests to the public application paths.
2. Replace turn-driven composite refreshes with event updates and scoped
   invalidation.
3. Deduplicate and cancel provider, model, and diagnostic requests.
4. Add only the indexes justified by the inspected application queries.
5. Enable complete test discovery and JavaScript undefined-name checking.
6. Reconcile user-facing documentation and run the final Windows and Linux
   checks.

## Verification

Run the focused integration tests while implementing each correction. At the
end of the phase, run:

```text
npm run lint
npm test
npm run build
```

On Windows and Linux, start the desktop host from a clone against a relocated
data root, restart it once, and confirm chat, persisted state, clean shutdown,
runtime state written outside the install tree, voice assets served from
`modelRoot`, and an agent-profile edit saved to `agentConfigPath`.

## Exit conditions

Phase 7 is complete when:

- the focused public paths complete without duplicate side effects;
- a normal turn performs no provider-health sweep or composite refresh;
- probes are timeout-bounded, cancellable, and deduplicated;
- added indexes serve demonstrated application queries;
- every matching Node test is discovered automatically;
- the start/restart check confirms the Phase 2 storage contract; and
- lint, tests, the production build, and one start/restart check pass on
  Windows and Linux.
