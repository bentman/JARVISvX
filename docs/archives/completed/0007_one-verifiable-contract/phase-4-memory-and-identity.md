# Phase 4: Memory and resource identity

Lifecycle: Planned

## Required outcome

Active memories participate in ordinary model turns through a deterministic,
bounded prompt contract. Explicit provider and agent identifiers resolve
exactly. Provider model selection follows one precedence rule shared by chat,
settings, diagnostics, and clients.

## Dependencies

Phase 3 provider-selection exit conditions shall pass. Memory prompt assembly
uses the provider selected by that contract and the Phase 1 authorization
context.

## Ownership

- `lib/memory-engine.mjs` owns memory selection and serialization.
- `lib/application.mjs` owns canonical model-request construction.
- provider adapters own translation of the canonical system instruction into
  their wire protocol.
- `lib/providers/index.mjs` owns provider identity and configured defaults.
- `lib/agents/registry.mjs` and `lib/agents/coordinator.mjs` own agent identity.
- `lib/database.mjs` owns deterministic persistence ordering.

## Requirements

### P4-R01: Active memory selection

Ordinary chat turns shall select persisted memories before provider invocation.
Selection shall be deterministic and bounded by a configured character or
token budget. Importance orders records `high`, `medium`, then `low`; more
recent records win within an importance level, with record ID as the final
tie-breaker.

The application and API shall accept only `high`, `medium`, or `low` for a
memory's importance. The database shall enforce the same set with
`CHECK(importance IN ('high','medium','low'))`. An idempotent migration shall
preserve valid values and map every null, blank, or unrecognized existing
value to `medium` before the constraint is installed. Invalid new input
returns a typed validation error and leaves persisted records unchanged.

Every stored memory is eligible until it is deleted. Records outside the
selected budget shall not enter the request. The memory engine shall expose
enough metadata for tests to determine which records were selected without
exposing that metadata to the end user.

### P4-R02: Canonical system instruction

The application shall construct one canonical system instruction from durable
assistant instructions, selected memory context, and capability context. Each
section shall have an explicit delimiter and stable order. User and assistant
conversation messages remain separate from this instruction.

Provider adapters shall accept the canonical instruction separately from
conversation messages and encode it according to their protocol. Anthropic
uses its top-level system field; OpenAI-compatible providers use a system
message; Gemini uses its system-instruction field; Ollama uses its supported
system representation. Azure OpenAI inherits the OpenAI-compatible encoding
and shall be covered by the same contract tests.

### P4-R03: Memory failure behavior

Malformed or oversized individual memories shall produce a diagnosable memory
selection result and shall not corrupt the turn payload. Database failures
shall fail the turn before provider invocation. Memory text is treated as data
inside the memory section and cannot change capability permissions or the
authorization context.

### P4-R04: Provider identity

Every API and application method receiving an explicit provider ID shall
resolve that record exactly. Unknown and disabled providers shall return typed
errors before creating messages, calling model discovery, or writing a turn
record. Automatic routing remains the only mechanism allowed to select another
provider.

### P4-R05: Agent identity

Solo, panel, debate, agent-bus, CLI, and UI requests shall validate all supplied
agent IDs before creating an agent-run record or spawning a process. A request
containing any unknown agent ID fails as a unit and identifies the unknown IDs.

The agent ID recorded for a run shall equal the profile that executes it.
Default agents are selected only when the request contains no agent IDs.

### P4-R06: Model precedence

The selected model shall use this precedence:

1. an explicit model supplied for the current request;
2. the saved per-provider model setting;
3. the provider record's configured default model; and
4. the first model returned by successful model discovery.

An explicit or configured model need not appear in a remote discovery list to
remain selected. Empty values are ignored. When no candidate exists, the turn
returns a typed model-required error before provider streaming.

Model discovery is advisory. Desktop and terminal clients shall not replace or
persist over a configured model merely because the discovery response omits
it. A client changes the saved model only through an explicit operator model
selection.

Settings, desktop controls, TUI state, diagnostics, and turn-start events shall
use this same resolver.

### P4-R07: Deterministic history

Conversation messages shall be ordered by creation timestamp and stable ID.
Provider history and API history shall use the same ordering. Persisted agent
runs shall reference the owning conversation when one is supplied and shall be
removed or retained according to an explicit foreign-key policy.

## Implementation targets

- `lib/memory-engine.mjs`
- `lib/application.mjs`
- `lib/api.mjs`
- `lib/database.mjs`
- `lib/providers/base.mjs`
- `lib/providers/openai-compat.mjs`
- `lib/providers/ollama.mjs`
- `lib/providers/anthropic.mjs`
- `lib/providers/gemini.mjs`
- `lib/providers/azure-openai.mjs`
- `lib/providers/index.mjs`
- `lib/agents/registry.mjs`
- `lib/agents/coordinator.mjs`
- `src/App.tsx`
- `src/api.ts`
- `src/types.ts`
- `src/components/ProvidersView.tsx`
- `bin/jarvis.mjs`
- `test/memory-center.test.mjs`
- `test/application.test.mjs`
- `test/providers.test.mjs`
- `test/agent-runtime.test.mjs`
- memory API route tests

## Implementation sequence

1. Migrate memory importance to the constrained value set and enforce the same
   validation in database and API write paths.
2. Define deterministic memory selection and budget behavior in the memory
   engine.
3. Introduce the canonical system-instruction field and update provider
   adapter request shapes.
4. Inject selected memory into ordinary chat and add captured-request tests.
5. Centralize exact provider and agent lookup with typed errors.
6. Validate complete panel/debate agent lists before recording work.
7. Centralize model resolution and use it in chat and settings.
8. Add stable message ordering and the agent-run conversation relationship.

## Verification

Capture one real application chat request containing bounded, ordered memory
and one request where excess memory is excluded. Test invalid importance
migration/input, unknown provider and agent IDs, model precedence, and one
canonical system-instruction request per provider protocol.

Run:

```text
node --test test/memory-center.test.mjs
node --test test/application.test.mjs
node --test test/providers.test.mjs
node --test test/agent-runtime.test.mjs
npm run lint
```

## Exit conditions

Phase 4 is complete only when:

- captured provider requests contain the expected bounded memory context;
- memory importance is constrained and deterministically migrated before
  selection;
- provider protocols encode the canonical system instruction correctly;
- unknown explicit IDs fail without downstream work;
- model selection follows the required precedence everywhere;
- model discovery preserves an explicit or configured model; and
- the focused memory, identity, model, and provider checks pass.
