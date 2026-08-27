# Next Optimization Target: Independent Position

## Context

The last several commits tightened structural correctness: WAL durability, state ownership narrowing, lazy daemon connection, fatal startup codes. The codebase is on a "simplify and harden" trajectory. This analysis asks: what is the highest-leverage next step?

---

## Findings

### 1. `database.mjs` is the largest design violation (52.6KB)

Single file mixes: DDL schema, CRUD queries, encryption key management, seed data, schema migrations, and read-only safe model definitions (8 view-like read models). Every module that touches persistence pulls in all 52KB.

Natural seams already exist — nothing needs to be invented:
- `schema.mjs` — CREATE TABLE DDL, PRAGMAs, FK setup
- `queries.mjs` — CRUD operations per domain (conversations, agents, providers, etc.)
- `migrations.mjs` — versioned migration steps, skill provenance backfill
- `encryption.mjs` — AES-256-GCM key derivation, encrypt/decrypt
- `read-models.mjs` — 8 protected read model definitions with row limits
- `database.mjs` — thin orchestrator: open, migrate, seed, close

### 2. Chat flow has zero integration tests

`POST /api/chat` streaming — the primary user-facing feature — has no integration test coverage. The test suite covers: daemon lifecycle, auth tokens, SSE hub, voice state, model selection. But the core loop (message persistence → provider call → tool execution → auth check → response stream) is untested end-to-end. Every structural improvement since the project started sits on an untested foundation for the feature that matters most.

Specific gaps:
- Streaming a response and verifying it's persisted to the DB
- Tool call → capability registry → auth grant consumption flow
- Turn cancellation via AbortController
- Authorization denial mid-turn (tool-approval-required event)

### 3. Authorization grant system may be over-engineered for the threat model

Single-use TTL grants (120s), replay prevention, and a full `authorization_audit` table exist to guard against prompt injection (a malicious LLM response attempting to self-approve a sensitive action). This threat is real and the design is sound in principle.

However: the audit table grows unbounded, grants are consumed in a single-use ledger per turn, and the full machinery adds 4.9KB to `authorization.mjs` plus schema complexity. For a local single-user application, a simpler turn-scoped approval flag (stored only in memory, never persisted to audit) would achieve identical UX with less complexity.

This warrants a separate ADR challenge, not a code change today.

---

## Recommendation

**Step 1 (safety net): Add chat flow integration tests before any refactoring.**

Rationale: decomposing `database.mjs` without a test that exercises the full chat path is risky. A failing test after refactor is information; a silent regression is not. Two tests cover the critical path:
- `chat-flow.test.mjs`: POST /api/chat → SSE stream → DB persistence → turn-complete event
- `tool-auth-flow.test.mjs`: tool call requiring approval → grant issuance → consumption → result

These tests can be written against the existing daemon test harness already in `test/daemon.test.mjs` (it starts a real daemon with a real SQLite instance).

**Step 2 (main target): Decompose `database.mjs` along its natural seams.**

Split into 6 focused modules (listed above). The orchestrating `database.mjs` becomes a thin open/close/migrate coordinator. No logic moves — only file boundaries change. Each piece becomes independently importable and testable.

Files affected:
- `lib/database.mjs` → split into `lib/db/schema.mjs`, `lib/db/queries.mjs`, `lib/db/migrations.mjs`, `lib/db/encryption.mjs`, `lib/db/read-models.mjs`, `lib/db/index.mjs`
- All importers of `database.mjs` update their import path (roughly 8-10 files in `lib/`)
- `test/database.test.mjs` reorganizes to match new module boundaries

**Step 3 (deferred): Open an ADR on authorization grant simplification.**

No code change yet. Write ADR-0009 arguing the case for turn-scoped in-memory approval vs. the current persisted grant ledger. Let the threat model and audit requirements decide.

---

## What NOT to do next

- **Do not decompose `application.mjs`** (26.6KB) yet — its concerns (turn loop, tool execution, memory injection) are more tightly coupled than `database.mjs`. Decomposing it without clear seams produces artificial interfaces.
- **Do not expand EventHub** (392B) — it does exactly one thing well. Adding persistence, replay, or typed event schemas would be premature.
- **Do not touch the agent adapter layer** — `AcpAdapter`/`ProcessAdapter` are already composable. No gain there.

---

## Verification

After Step 1:
- `npm test` passes with new chat flow tests included
- New tests fail if message is not persisted or stream does not yield turn-complete

After Step 2:
- `npm test` passes unchanged (behavior preserved, only import paths changed)
- Each `lib/db/*.mjs` file is under 15KB
- `lib/db/index.mjs` re-exports everything for backwards compatibility during transition
