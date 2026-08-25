# ADR 0005: One provider selection per turn

Status: Accepted
Date: 2026-08-25

## Context

Provider selection was split across two places. `application.chat()` resolved an
explicit id inside a `try { … } catch {}` and then called `routeTurn()` anyway,
so the same id was consulted twice and a failure to resolve it was silently
discarded. `routeTurn()` itself fell through on an unresolved id: an unknown
user override dropped to the agent pin, then to the mode pin, then to tag
policy, so a typo could quietly run the turn somewhere else.

Auto mode ended in `registry.list()[0]`, which returns whatever sorts first and
carries no tag guarantee. The settings response reported that same array head as
`activeProvider`, so the label the operator read was not the outcome of any
decision. Clients had no way to express "let orchestration choose": the desktop
seeded a hardcoded provider id and every refresh overwrote the operator's
selection with the server's guess.

Agent profiles could name a provider. Nothing read it — the coordinator forwarded
only the caller's id, and an unpinned agent fell back to registry order rather
than the configured mode.

## Decision

`lib/orchestrator.mjs` owns one selection operation, `routeTurn()`, and
`lib/application.mjs` exposes it as `selectProvider()` for every origin.

**Precedence stops at the first supplied input.** An explicit user id, an agent
profile pin, and a `provider:<id>` mode are each resolved against the registry
or refused. None falls through to a lower source, so a bad id fails as itself
rather than being replaced by a different provider.

**One result shape.** A selection is either `{ provider, reason, source }` —
`source` being `user`, `agent`, `mode-pin`, `policy`, `auto-local`, or
`auto-escalated` — or `{ provider: null, code, reason, mode }` with `code` one
of `unknown_provider`, `provider_disabled`, `no_eligible_provider`, or
`cloud_approval_required`. `ProviderRegistry.status()` distinguishes an id that
names nothing from one that names a disabled provider.

**Eligibility only.** Routing reads whether the turn holds a cloud grant so it
knows a cloud provider is reachable, and never authorizes. The grant is consumed
by the single authorization check that already guards transmission, so no second
approval path exists.

**No tag crossing.** `local_only` and `cloud_only` refuse rather than substitute.
Auto mode selects an eligible local provider, escalates to cloud only when a rule
matches and the grant is present, and otherwise refuses — the array-order
fallback is gone.

**Selection happens first.** `chat()` selects before creating a turn message and
before calling `listModels()`, so an unresolvable id costs nothing.

**Settings describe the effective selection.** `activeProvider` is the provider
an unpinned turn would route to right now, with its `source`, the saved model per
provider, and the reason when nothing is eligible. `null` means automatic.

**Automatic is a client state.** The desktop and TUI hold the operator's choice
as "none selected", omit `providerId` while it is selected, and never let a
settings refresh replace it with a concrete id. The turn-start event carries the
provider, model, and routing reason actually used, and the clients reconcile
their labels from that rather than from local state.

## Consequences

- One code path answers "which provider" for desktop text, desktop voice, TUI,
  one-shot CLI, and agent turns.
- A mistyped or disabled provider id is reported as that, at the moment it is
  supplied, instead of running the turn somewhere the operator did not choose.
- An operator can see that selection is automatic and, after a turn, which
  provider it actually reached and why.
- An agent profile pin now has an effect, applies only to agent-originated
  turns, and outranks the configured mode without outranking an explicit id.
- Adding a routing input means adding a precedence step and a `source`, not a
  second resolution site.
- Health (`GET /api/providers`), registry CRUD (`/api/provider-registry`),
  settings, and turn selection are four distinct concerns; ADR 0001 covers the
  first two.
