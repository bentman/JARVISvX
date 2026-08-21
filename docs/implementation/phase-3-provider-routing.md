# Phase 3: Provider selection and routing

Lifecycle: Planned

## Required outcome

Desktop text, desktop voice, TUI, one-shot CLI, and delegated model turns use
one provider-selection contract. Automatic orchestration applies when the
operator has not supplied an explicit provider override. An explicit override
selects exactly one provider and remains subject to the Phase 1 authorization
policy.

## Dependencies

Phase 1 authorization exit conditions shall pass. Provider routing must not
create an alternate cloud-approval path.

## Ownership

- `lib/orchestrator.mjs` owns provider routing decisions and explanations.
- `lib/application.mjs` owns explicit-override validation and invocation of
  the orchestrator.
- `lib/agents/runtime.mjs` and `lib/agents/coordinator.mjs` own propagation of
  a validated agent-profile provider pin for agent-originated turns.
- `lib/providers/index.mjs` owns provider records, tags, priority, and
  enabled state.
- `lib/api.mjs` and `src/api.ts` own the serialized routing/settings contract.
- `src/App.tsx`, `src/components/ModelOrchestrationView.tsx`, and
  `bin/jarvis.mjs` own operator selection and presentation.

## Requirements

### P3-R01: Selection inputs

Provider resolution shall apply this precedence:

1. an explicit per-turn user provider ID;
2. for an agent-originated turn, the validated provider ID pinned to that
   executing agent profile;
3. a provider ID pinned by `provider:<id>` orchestration mode; and
4. the tag-based policy for `auto`, `local_only`, or `cloud_only`.

A turn with none of the first three inputs requests tag-based orchestration.
Each supplied ID selects exactly that enabled provider or returns a typed
error; an invalid higher-precedence input does not fall through to a lower
precedence source.

Desktop text, desktop voice, TUI, and one-shot CLI chat have no selected agent
profile and therefore omit the second input. The agent runtime shall pass the
executing profile's validated provider ID into the shared routing operation.

Clients shall represent automatic selection explicitly in their local state
and omit `providerId` from the request while it is selected. Loading settings
shall not replace automatic selection with a concrete provider ID.

### P3-R02: Orchestration modes

The orchestrator shall implement the configured mode using provider registry
records:

- `auto` selects an eligible local provider and may escalate to an eligible
  cloud provider when the routing rule and Phase 1 cloud grant both permit it.
- `local_only` selects only enabled providers tagged `local`.
- `cloud_only` selects only enabled providers tagged `cloud` and requires the
  cloud grant before transmission.
- `provider:<id>` selects the named enabled provider and retains its normal
  authorization requirements.

If the configured mode has no eligible provider, routing returns a typed
unavailable result with the mode and eligibility reason. It shall not silently
cross a tag or approval boundary.

Every branch of provider resolution, including user, agent, and mode pins,
shall pass the final provider through the Phase 1 cloud policy before provider
metadata or network operations are performed.

### P3-R03: Explicit override behavior

An explicit provider ID shall be resolved before creating turn messages or
calling `listModels()`. Unknown or disabled IDs return typed errors. Explicit
selection does not update the persistent orchestration mode unless the
operator uses the settings endpoint that owns that change.

### P3-R04: Authoritative settings response

The settings response shall expose distinct fields for:

- configured orchestration mode;
- selected client override, when persisted by product design;
- effective default provider candidate;
- saved model for each provider; and
- whether eligible cloud providers are configured.

`activeProvider` and `activeModel` labels shall refer to a defined effective
selection, not registry array order. Desktop and TUI labels shall distinguish
`Automatic` from a concrete provider.

### P3-R05: Routing result evidence

The turn start event and persisted assistant message shall identify the
provider and model actually used. When orchestration selected the provider,
the event shall include a stable routing reason suitable for diagnostics.
Client optimistic state shall reconcile to this server result.

### P3-R06: Shared behavior across origins

Voice transcripts shall enter the same `application.chat()` selection path as
desktop text. TUI and one-shot CLI requests shall serialize the same absence or
presence of `providerId`. Agent model calls that request orchestration shall use
the same registry and authorization rules.

## Implementation targets

- `lib/orchestrator.mjs`
- `lib/application.mjs`
- `lib/agents/runtime.mjs`
- `lib/agents/coordinator.mjs`
- `lib/agents/adapters/process.mjs`
- `lib/providers/index.mjs`
- `lib/api.mjs`
- `lib/daemon-client.mjs`
- `src/api.ts`
- `src/types.ts`
- `src/App.tsx`
- `src/components/ModelOrchestrationView.tsx`
- `src/components/SettingsPanel.tsx`
- `bin/jarvis.mjs`
- `test/application.test.mjs`
- `test/agent-runtime.test.mjs`
- `test/orchestration.test.mjs`
- `test/cli.test.mjs`
- provider-registry route tests

## Implementation sequence

1. Define and test the selection input and routing result shapes.
2. Wire the executing agent profile's validated provider pin from agent
   runtime and coordination into the shared routing operation.
3. Make `application.chat()` validate explicit overrides and invoke routing
   only for absent overrides.
4. Derive settings from orchestration configuration and registry eligibility.
5. Add `Automatic` client state and omit `providerId` in that state.
6. Reconcile client displays from the server's turn-start result.
7. Apply the same serialization in voice, TUI, and one-shot CLI paths.
8. Remove `evaluateTurnRouting` and its legacy tests after all callers and
   assertions use `routeTurn` and the selection-result contract.
9. Update ADR 0001 or add a routing ADR so health, registry CRUD, settings,
   and turn selection have distinct ownership.

## Verification

Use deterministic fake providers tagged local and cloud. For each client
origin, test `auto`, `local_only`, `cloud_only`, `provider:<id>`, explicit
override, agent-profile pin, unknown override, disabled override, no eligible
provider, cloud grant absent, and cloud grant present. Precedence tests shall
combine user, agent, and mode pins and prove that the highest supplied input is
selected exactly.

Tests shall assert the exact provider call count, selected provider ID, routing
reason, and absence of calls to ineligible providers. UI/TUI tests shall prove
that loading settings preserves Automatic state and that selecting a provider
creates an explicit override only for intended turns.

Agent tests shall prove that a profile pin is propagated for agent-originated
turns, outranks the orchestration-mode pin, fails exactly when unknown or
disabled, and is absent from ordinary chat routing.

Run:

```text
node --test test/application.test.mjs
node --test test/agent-runtime.test.mjs
node --test test/orchestration.test.mjs
node --test test/cli.test.mjs
npm run lint
npm test
npm run build
```

## Exit conditions

Phase 3 is complete only when:

- every user interaction origin passes the provider-selection matrix;
- automatic client state omits `providerId`;
- explicit IDs resolve exactly or fail before provider work;
- agent-profile pins affect only agent-originated turns and reach the shared
  routing operation;
- settings and turn-start events report defined effective selections;
- the deprecated routing function and tests no longer encode a second policy;
- routing never crosses local, cloud, enabled, or approval eligibility; and
- targeted tests, lint, full suite, and build pass in the implementation
  revision.
