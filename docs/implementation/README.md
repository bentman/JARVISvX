# JARVISvX implementation program

Lifecycle: Planned

## Purpose

This program defines the required work for making the daemon, desktop host,
CLI, provider layer, capability system, agent runtime, voice runtime, and
packaged application follow one verifiable contract. It is the implementation
entry point for the seven phase specifications in this directory.

`AGENTS.md` governs repository-wide engineering practice. The documents in
this directory define the behavior, ownership, dependencies, and acceptance
criteria for this implementation program. An implementation changes a stated
requirement only by updating the owning phase specification before changing
code.

## System invariants

Every phase preserves these invariants:

1. The daemon owns SQLite state, provider configuration, routing, capability
   execution, agent coordination, and the shared SSE event stream.
2. The Electron renderer and CLI reach daemon-owned behavior through the same
   application and API contracts.
3. Each cloud transmission, filesystem mutation, external process with
   mutation authority, and mutating MCP operation requires a scoped,
   single-use daemon grant assigned to the current turn or operation.
4. Workspace access resolves to a real path contained by an approved root.
5. Explicit identifiers select exactly the named resource or return a typed
   not-found error.
6. Health, hardware, model, and completion information reports observed state.
   Unknown state is represented as unknown; it is not replaced with a sample
   value.
7. A phase is complete only when its required automated checks and runtime
   observations have been executed successfully.

## Implementation sequence

| Phase | Specification | Depends on | Primary outcome |
|---|---|---|---|
| 1 | [Authorization and execution boundaries](phase-1-authorization-boundaries.md) | None | One enforceable authorization path for providers, skills, tools, agents, and workspace writes |
| 2 | [Packaged runtime storage](phase-2-packaged-runtime-storage.md) | Phase 1 contract definitions | Writable, persistent runtime state in source and packaged execution |
| 3 | [Provider selection and routing](phase-3-provider-routing.md) | Phase 1 | One provider-selection contract across desktop, TUI, CLI, and voice |
| 4 | [Memory and resource identity](phase-4-memory-and-identity.md) | Phase 3 | Memory reaches model turns; identifiers and default models resolve deterministically |
| 5 | [Workspace, MCP, provider, and API contracts](phase-5-integration-contracts.md) | Phases 1, 3, and 4 | Consistent cross-layer schemas, transport behavior, status reporting, and provider protocols |
| 6 | [Runtime reliability](phase-6-runtime-reliability.md) | Phases 1 through 5 | Deterministic startup, migration, voice, CLI, and multi-agent behavior |
| 7 | [Verification and performance hardening](phase-7-verification-performance.md) | Phases 1 through 6 | Cross-layer regression coverage, bounded refresh work, indexed persistence, and release evidence |

Phases execute in numeric order. Work within a phase may be divided into small
commits when each commit preserves the phase contract and passes the checks
required for its changed surface.

## Requirement execution protocol

An agentic coding assistant implementing a phase performs this sequence:

1. Read `AGENTS.md`, this document, the phase specification, and each source or
   test file named under **Implementation targets**.
2. Confirm the preceding phase exit conditions in the current working tree.
   A passing historical report is not evidence for the current tree.
3. Add or update the narrowest regression test that demonstrates each changed
   contract. Tests assert externally observable behavior rather than private
   implementation details.
4. Implement the smallest shared mechanism that satisfies the numbered
   requirements. The desktop, CLI, and voice entry points reuse daemon-owned
   policy and state rather than duplicating it.
5. Run the targeted checks listed by the phase, then `npm run lint`,
   `npm test`, and `npm run build` at the phase exit. For Phases 1 through 6,
   `npm run lint` is evidence for renderer TypeScript only; backend evidence
   comes from the relevant Node tests and runtime checks. Phase 7 expands lint
   to the backend and replaces manually enumerated test selection. Until that
   gate is complete, confirm that each test named by the phase is executed
   directly as well as through `npm test`.
6. Inspect `git diff --check`, `git diff`, and `git status --short`. Report the
   checks actually run and their results. A phase remains incomplete while any
   exit condition lacks current evidence.

Architecture changes to trust boundaries, filesystem authority, provider
routing, or persistent storage include a short ADR under `docs/adr/`. The ADR
records the durable decision; the phase specification remains the source for
implementation scope and acceptance.

## Traceability

This table assigns every program concern to an owning phase. A concern appears
in more than one phase only when the later phase verifies or completes a
contract established earlier.

| ID | Required correction | Owning phase |
|---|---|---|
| C01 | Issue, scope, consume, and test per-turn desktop approvals | 1 |
| C02 | Gate provider calls made by slash skills | 1 |
| C03 | Constrain custom skill and ACP agent authority | 1 |
| C04 | Resolve workspace paths through approved real paths | 1 |
| C05 | Store packaged runtime data and file-backed credential key material outside the ASAR archive | 2 |
| C06 | Persist mutable agent configuration outside tracked source | 2 |
| C07 | Apply orchestration and agent-profile provider pins through one routing contract | 3 |
| C08 | Constrain memory ordering inputs and inject active memories into model requests | 4 |
| C09 | Reject unknown explicit provider and agent identifiers | 4 |
| C10 | Apply the configured provider default model deterministically | 4 |
| C11 | Align workspace-edit states across database, API, and UI | 5 |
| C12 | Discover, type, classify, execute, migrate, and diagnose MCP tools correctly | 5 |
| C13 | Report observed provider, endpoint, hardware, and acceleration health | 5 |
| C14 | Normalize provider request roles and protocol tests | 5 |
| C15 | Define the loopback token boundary and remove token URL transport | 5 |
| C16 | Make Windows data migration handle an existing empty destination | 6 |
| C17 | Make daemon ownership liveness and client readiness deterministic | 6 |
| C18 | Bound voice startup, downloads, capture queues, and UI ownership | 6 |
| C19 | Return truthful CLI status and synthesize the documented agent rosters | 6 |
| C20 | Bound refresh work, index persisted queries, and close cross-layer test gaps | 7 |

## Completion record

The program is complete when all seven phase documents meet their exit
conditions in the same integrated revision. Phase completion is recorded in a
review or pull request with command output and runtime evidence; these
specifications do not use checked boxes as a substitute for verification.
