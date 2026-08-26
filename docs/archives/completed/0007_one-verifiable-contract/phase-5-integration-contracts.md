# Phase 5: Workspace, MCP, provider, and API contracts

Lifecycle: Planned

## Required outcome

Database states, REST shapes, frontend types, MCP transports, provider
protocols, health checks, and diagnostic displays describe the same observed
behavior. Every public operation returns a typed success or failure and every
reported availability value is backed by a completed probe.

## Dependencies

Phases 1, 3, and 4 shall pass. This phase applies their authorization,
selection, identity, and canonical-request contracts to integration surfaces.

## Ownership

- `lib/database.mjs` owns persisted states and migrations.
- `lib/api.mjs` owns HTTP status and response shapes.
- `src/api.ts` and `src/types.ts` own client representations.
- `lib/mcp-stdio.mjs` and `lib/mcp-skills.mjs` own MCP transport behavior.
- `lib/providers/` owns provider protocol serialization and live health.
- `lib/diagnostics.mjs` and `lib/orchestrator.mjs` own measured diagnostic
  aggregation.

## Requirements

### P5-R01: Workspace-edit state machine

Workspace edits shall use these states across database, API, SSE, and UI:

```text
pending_review -> approved_and_applied
pending_review -> rejected
```

Approval writes the validated file once and records
`approved_and_applied` only after the write succeeds. A failed write leaves the
edit reviewable and returns a typed failure. A terminal edit rejects repeated
approve or reject operations with a conflict response. The UI shall render the
persisted state directly. The existing write-before-status ordering shall be
preserved while status vocabulary and transition enforcement are aligned.

### P5-R02: Resource HTTP semantics

Lookup, update, toggle, approve, reject, and delete operations on an unknown ID
shall return HTTP 404 with the common API error shape. Invalid state
transitions return HTTP 409. Invalid request data returns HTTP 400. Provider,
memory, skill, MCP, workspace, conversation, and agent routes shall apply this
contract consistently.

### P5-R03: MCP discovery and schema fidelity

Adding or refreshing an MCP server shall perform the transport's initialization
and `tools/list` exchange. Discovered tool names, descriptions, JSON Schema,
annotations, and server identity shall be stored as the server's callable
contract.

Capability conversion shall preserve object, array, string, number, integer,
boolean, enum, required, and nested-property semantics supported by provider
tool schemas. Unsupported schema features shall produce a visible diagnostic
instead of being converted silently.

HTTP and stdio servers shall reach the same normalized tool representation.

### P5-R04: MCP execution and health

HTTP MCP calls shall use JSON-RPC request IDs, a bounded timeout, cancellation,
content-type validation, HTTP status validation, and JSON-RPC error handling.
An RPC error is a failed capability result. Stdio calls shall enforce the same
logical timeout and structured error behavior.

MCP health shall be based on a successful protocol exchange, not a generic GET
status. The database shall persist the observed status, latency, probe time,
and failure reason. UI test execution shall use the Phase 1 dispatcher and
approval path.

The `mcp_servers` schema shall use `status` values `unknown`, `connected`, and
`error`; nullable `latency_ms`; nullable `last_probe_at`; and nullable
`failure_reason`. A completed successful probe sets `connected`, measured
latency, and probe time and clears the failure reason. A completed failed probe
sets `error`, measured elapsed time when available, probe time, and a bounded
failure reason. Registration alone leaves status `unknown` and all observation
fields null.

New and seeded MCP records shall begin with `unknown` health and no observed
latency. Random or sample latency values shall not be persisted. Built-in
workspace and SQLite availability shall be derived from their owning runtime
and recorded only after that check completes.

An idempotent migration shall add the observation columns, make latency
nullable, and change the initial status default to `unknown`. Existing rows
without a persisted probe time cannot prove that their status or latency was
observed and shall migrate to `unknown` with null observation fields.

### P5-R05: Provider health

Provider health shall perform a bounded live operation appropriate to the
configured transport. A hardcoded model catalog may support UI selection but
shall not establish availability. Health shall distinguish at least:

- available and authenticated;
- reachable with an authentication or configuration error;
- unreachable or timed out; and
- not configured.

Routing eligibility uses measured health according to a documented freshness
window. A stale result is labelled stale and revalidated before a cloud or
explicit availability claim.

Anthropic and Gemini model catalogs shall remain separate from health because
their catalog methods are local constant lists. Their health implementations
shall perform bounded credential and endpoint probes before reporting
available.

### P5-R06: Provider protocol contracts

Each provider adapter shall have request and streaming tests for canonical
system instructions, conversation roles, explicit models, cancellation,
provider errors, and its supported tool-call format. Adapters shall translate
the canonical request without placing unsupported roles in protocol message
arrays.

Agent model requests and ordinary chat requests shall use the same adapter
contract.

### P5-R07: Observed local and hardware diagnostics

Local endpoint detection shall report models only when a completed endpoint
probe returned them. Failed probes return an empty model list and a failure
reason. Hardware and acceleration fields shall contain measured values or an
explicit `unknown`/`unavailable` state.

`pingLocalEndpoint` shall compute latency from its request start time on every
return path. A reachable response with no models and an unreachable endpoint
shall both avoid undeclared values and fabricated model catalogs; each shall
return its observed status, elapsed time, empty models, and reason.

Token throughput is shown only when measured from the active model and backend.

### P5-R08: Loopback session boundary

The daemon shall remain loopback-bound. The token authenticates daemon HTTP and
SSE requests from clients; it is not described as an operating-system security
boundary against local processes.

Electron main shall reuse the existing constrained
`electron/preload.cjs`/`jarvis:daemon` IPC bridge to deliver the token to the
renderer. Electron navigation shall omit the token query, and the renderer
shall not parse token-bearing URL state. Logs, error messages, history, and
diagnostic payloads shall omit the token.

`GET /api/session` remains the browser-hosted UI bootstrap path. It shall be
available only over a loopback connection and valid daemon origin/host,
include `Cache-Control: no-store`, and remain unreadable cross-origin. Electron
and CLI clients shall use their existing IPC and discovery mechanisms rather
than this endpoint.

### P5-R09: Contract source and validation

Shared status values and response fields shall have one authoritative runtime
definition that backend serializers and TypeScript types derive from or test
against. Route tests shall validate both HTTP status and response shape.

## Implementation targets

- `lib/database.mjs`
- `lib/application.mjs`
- `lib/api.mjs`
- `lib/capabilities.mjs`
- `lib/mcp-stdio.mjs`
- `lib/mcp-skills.mjs`
- `lib/diagnostics.mjs`
- `lib/orchestrator.mjs`
- `lib/providers/base.mjs`
- every adapter under `lib/providers/`
- `electron/main.mjs`
- `electron/preload.cjs`
- `src/api.ts`
- `src/types.ts`
- `src/components/WorkspacesPanel.tsx`
- `src/components/McpSkillsView.tsx`
- `src/components/DiagnosticsPanel.tsx`
- `docs/conventions-ids-and-crud.md`
- `test/mcp-stdio.test.mjs`
- provider, route, MCP, workspace, and diagnostics tests

## Implementation sequence

1. Define shared state and error contracts; migrate workspace statuses,
   enforce transitions, and update the CRUD/state-machine convention.
2. Normalize route status codes and client error handling.
3. Implement MCP discovery and lossless supported-schema normalization.
4. Migrate `mcp_servers` to the health-state and observation schema, including
   nullable latency, probe time, failure reason, and the `unknown` default.
5. Apply protocol timeouts, cancellation, error parsing, unknown initial
   health, measured latency persistence, and Phase 1 dispatch to both
   transports.
6. Separate provider model catalogs from live health, remove undeclared and
   synthetic local-endpoint fallback paths, and add per-adapter
   request/stream fixtures.
7. Replace synthetic endpoint and hardware values with observed or unknown
   states.
8. Remove Electron URL token delivery in favor of the existing constrained
   renderer bridge, harden the browser session bootstrap contract, and redact
   the token from diagnostics.
9. Update or add ADRs for MCP trust metadata and the loopback client boundary.

## Verification

Use local mock HTTP and stdio servers for one successful MCP discovery and
execution path plus timeout, RPC failure, and mutating-tool approval. Migrate
one legacy MCP fixture and confirm unknown health becomes measured success or
failure without sample data.

Provider checks shall confirm each protocol request shape and that a closed
local endpoint reports no fabricated models. API checks shall cover an unknown
resource, one invalid workspace transition, and token-free Electron navigation.

```text
node --test test/mcp-stdio.test.mjs
node --test test/mcp-skills.test.mjs
npm run lint
```

## Exit conditions

Phase 5 is complete only when:

- workspace state and API errors use the defined values;
- HTTP and stdio MCP tools discover and execute through the shared dispatcher;
- unannotated MCP operations require approval;
- MCP, provider, and diagnostic health contain only observed or explicitly
  unknown values;
- the Electron navigation URL and logs contain no daemon token; and
- the focused MCP, provider, API, and Electron checks pass.
