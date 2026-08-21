# Phase 7: Verification and performance hardening

Lifecycle: Planned

## Required outcome

The integrated application has executable regression coverage for its client,
daemon, provider, capability, storage, packaging, and voice boundaries.
Routine interaction performs bounded network and database work, and release
claims are supported by current automated and runtime evidence.

## Dependencies

Phases 1 through 6 shall meet their exit conditions. This phase verifies the
integrated contracts and optimizes only measured or structurally demonstrated
hot paths.

## Ownership

- `test/` owns deterministic daemon and subsystem integration tests.
- the frontend test configuration owns renderer behavior tests.
- `scripts/` owns packaged smoke and repeatable performance checks.
- `src/App.tsx` and client hooks own request deduplication and event-driven
  refresh behavior.
- `lib/database.mjs` owns schema indexes, query ordering, and migration.
- `README.md`, operator guides, and ADRs own current externally visible
  behavior.

## Requirements

### P7-R01: Cross-layer contract suites

Automated tests shall exercise these paths from public entry point to recorded
effect:

- desktop/TUI/CLI/voice request to routing, provider invocation, SSE, and
  conversation persistence;
- per-turn authorization to allowed or denied provider/tool/skill/agent work;
- memory selection to captured provider request;
- workspace proposal to approved write and rendered final status;
- MCP discovery to schema exposure, execution, and result event;
- agent request to participant execution, synthesis, and run persistence; and
- source and packaged startup to writable state and clean shutdown.

Tests shall assert side-effect counts and terminal states so silent fallback,
duplicate execution, and false success cannot pass.

Existing tests shall be audited for connection to the production path they
claim to cover. The memory suite shall capture a real `application.chat()`
provider request rather than only testing `formatMemoriesContext()` in
isolation. Local-endpoint tests shall exercise both model-bearing success and
closed or unusable endpoint paths, including empty model results.

### P7-R02: Renderer behavior harness

The Vite-compatible renderer test harness established for Phase 1 authorization
shall cover approval consumption, Automatic provider state, optimistic-message
reconciliation, error/cancellation rendering, workspace states, MCP approval,
Voice HUD command routing, and agent selection. Its DOM environment and
dependencies shall remain limited to behavior exercised by these contracts.

Network and SSE clients shall be injected or mocked at the API boundary.
Component tests shall not require a live provider or microphone.

### P7-R03: Provider refresh budget

Initial desktop load may perform one provider-health request and one model-list
request for the effective concrete provider. Starting, streaming, and
completing an ordinary turn shall not trigger a full provider-health sweep.

Provider health shall refresh on explicit operator action, relevant
configuration change, or expiry of a documented cache freshness interval.
Concurrent equivalent refreshes shall share one in-flight request. Superseded
model requests shall be aborted, and stale responses shall not overwrite the
newer provider selection.

SSE handlers shall update conversation and turn state from event payloads and
shall not call the composite application `refresh()` operation. Post-send
completion shall not repeat work already represented by terminal SSE events.
Provider administration callbacks shall invalidate only provider/model state;
conversation deletion shall refresh only conversation state.

Renderer tests shall assert request counts for initial load, provider change,
successful turn, failed turn, cancellation, and repeated SSE events.

### P7-R04: Provider and diagnostic time bounds

Every network probe shall accept an abort signal and enforce a configured
timeout. Aggregation timeout shall abort unfinished probes rather than only
stop awaiting them. A repeated refresh shall not leave prior probes running.

Diagnostics shall report probe age and timeout state. The performance test
shall count active mock requests after cancellation and require zero orphaned
requests.

### P7-R05: SQLite indexes and deterministic queries

An idempotent schema migration shall add indexes supporting the application's
frequent access patterns, including:

- messages by `(conversation_id, created_at, id)`;
- conversations by `(updated_at, id)`;
- agent runs by conversation and creation time;
- agent runs by status and creation time;
- workspace edits by status and creation time; and
- other repeated filters demonstrated by query inspection.

Queries shall include deterministic tie-breakers. `EXPLAIN QUERY PLAN` tests on
representative populated fixtures shall prove that the indexed access paths are
used. Foreign-key tests shall cover conversation deletion and its defined
agent-run policy.

### P7-R06: Event-loop work budget

Synchronous database calls shall remain bounded single statements or short
transactions. A repeatable fixture benchmark shall measure conversation list,
history load, memory selection, workspace-edit list, and agent-run list at
representative history size.

The benchmark records fixture size, command, operating system, Node version,
median, and high-percentile duration. A measured regression above an accepted
baseline blocks phase completion or is recorded as a named release limitation
at the same prominence as the performance claim.

### P7-R07: Packaging and runtime matrix

The release verification matrix shall cover:

- source daemon and CLI on Windows;
- packaged Electron startup and restart on Windows;
- Linux source daemon and CLI when Linux support is claimed; and
- packaged Linux startup when a Linux package is published.

The matrix verifies writable paths, migration, lock ownership, authorization,
routing, provider mock communication, voice degraded startup, and clean
shutdown. External provider credentials are not required; protocol behavior is
verified with local mock servers.

### P7-R08: Documentation consistency

README architecture and storage tables, quick starts, operator guides,
accepted ADRs, API names, status values, and test commands shall describe the
implemented behavior. Documentation shall link to another document only from a
navigation section or where the reader must consult the target to act
correctly.

`AGENTS.md` shall define the repository's canonical ADR location as
`docs/adr/adr-NNNN-<slug>.md`. Any documentation or source artifact that must
name an ADR to support correct action shall use that location; artifacts that
do not require the reference shall contain no ADR-path placeholder.

README storage documentation shall distinguish source and packaged layouts and
identify the implemented SQLite path, daemon lock and discovery files,
provider-credential key material, and mutable agent configuration. It shall
state that provider key material is preserved and migrated with SQLite.

Seed data and UI descriptions shall name technologies and capabilities
actually present in the repository; the frontend stack memory shall describe
the repository's React and authored-CSS implementation rather than Tailwind.

### P7-R09: Release evidence

A release candidate shall produce one verification record containing the
revision, platform, runtime versions, commands executed, pass/fail counts,
packaged smoke result, and named limitations. Completion language shall match
the weakest evidence: unit-tested, integration-tested, packaged-smoke-tested,
or manually observed.

### P7-R10: Static-analysis coverage

`npm run lint` shall validate both renderer TypeScript and repository
JavaScript. Use separate `lint:types` and `lint:js` scripts, with `lint`
running both. `lint:js` shall use an ESM-aware static analyzer such as ESLint
across `lib/`, `bin/`, `electron/`, `scripts/`, and `test/`, including
undefined-name detection that rejects an undeclared shorthand value.

The lint configuration shall represent Node, browser, worker, and test globals
by file scope. Generated artifacts, dependencies, runtime data, and packaged
output shall be excluded explicitly.

### P7-R11: Complete test discovery

`npm test` shall discover every `test/**/*.test.mjs` file automatically while
preserving deterministic concurrency. The package script shall not enumerate
individual test filenames. `test/mcp-stdio.test.mjs` and every future matching
test shall therefore run without a package-script edit.

Phase-specific commands may continue to name individual files for fast
feedback, but the full-suite gate uses discovery.

## Implementation targets

- `src/App.tsx`
- `src/api.ts`
- `src/hooks/`
- frontend test configuration and component tests
- `lib/diagnostics.mjs`
- `lib/application.mjs`
- `lib/capabilities.mjs`
- `lib/providers/base.mjs`
- `lib/database.mjs`
- `test/`
- `scripts/package-desktop.mjs`
- new deterministic smoke and performance scripts under `scripts/`
- `package.json`
- lint configuration
- `AGENTS.md`
- `src/types.ts`
- `test/tool-calling.test.mjs`
- `README.md`
- `docs/OperatorsGuide-GUI.md`
- `docs/OperatorsGuide-CLI.md`
- `docs/QuickStart-windows.md`
- `docs/QuickStart-linux.md`
- `docs/adr/`

## Implementation sequence

1. Extend the renderer behavior harness and close the client contract gaps from
   Phases 1 through 6.
2. Add public-entry-point integration fixtures for chat, capability, workspace,
   MCP, agent, and packaged storage flows.
3. Replace turn-driven health sweeps with explicit, cached, deduplicated,
   abortable refresh operations.
4. Add the index migration, deterministic ordering, query-plan assertions, and
   foreign-key tests.
5. Add repeatable request-count, orphaned-probe, database-fixture, and voice
   queue performance checks.
6. Automate the supported platform and packaged smoke matrix.
7. Add backend static analysis and replace the enumerated full-test script with
   automatic `*.test.mjs` discovery.
8. Reconcile README storage and architecture, guides, ADRs, comments, seed
   data, and API types with the verified implementation. Verify the canonical
   ADR path and document SQLite, daemon ownership files, provider key material,
   and agent configuration in both source and packaged layouts.
9. Execute the complete release gate and record evidence for the candidate
   revision.

## Verification

Run all phase-specific suites, then:

```text
npm run lint
npm test
npm run build
git diff --check
```

Run the renderer behavior suite, the automatically discovered full Node suite,
packaged smoke script, database query-plan and fixture benchmark, provider
request-count test, cancelled-probe test, and voice slow-consumer benchmark
through named package scripts. Each script shall return nonzero on a failed
contract.

Inspect the packaged application on every release platform in scope. Record the
artifact identity and runtime path root so the observation is reproducible.

Run a repository-wide ADR-reference check and verify every remaining path
resolves under `docs/adr/`. Inspect the source and packaged storage roots used
by the smoke tests and compare each generated mutable artifact with the README
layout.

## Exit conditions

Phase 7 is complete only when:

- all cross-layer paths in P7-R01 have deterministic regression tests;
- renderer behavior tests cover every approval and client-state contract;
- a normal turn causes no provider-health sweep and request-count tests pass;
- cancellation leaves no live mock network probe;
- query-plan tests use the required indexes with deterministic ordering;
- static analysis covers renderer TypeScript and backend JavaScript, including
  undefined identifiers;
- `npm test` automatically executes every matching Node test, including MCP
  stdio transport tests;
- performance checks have a recorded current baseline and no unexplained
  regression;
- the supported platform/package matrix passes;
- the documentation targets named by P7-R08 use the canonical ADR location,
  accurately identify mutable storage, and contain no unsupported capability
  claims; and
- lint, full tests, build, smoke tests, and performance gates pass for the same
  candidate revision.
