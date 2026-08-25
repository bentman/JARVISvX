# ADR 0001: Separate provider health and registry routes

Status: Accepted
Date: 2026-08-18

## Context

Provider health and provider configuration expose different representations of
the same provider records. Health reads perform live model discovery and return
runtime availability with effective settings. Configuration operations return
stored records and support mutation, connection probing, and enablement changes.

Express route registration requires these contracts to have distinct paths so
each request resolves to one handler and one response shape.

## Decision

`lib/api.mjs` owns two provider route families:

- `GET /api/providers` returns `{ settings, providers }`. `settings` comes from
  `application.settings()`, and each item in `providers` is the live health result
  of an enabled provider instance.
- `/api/provider-registry` owns stored provider administration. It provides list,
  create, read, update, delete, probe, test, and toggle operations over provider
  records.

`lib/application.mjs` reloads the in-memory `ProviderRegistry` after each stored
provider mutation. `src/api.ts` exposes the health contract through
`providerHealth()` and the registry contract through `providers()`,
`addProvider()`, `updateProvider()`, `deleteProvider()`, `testProvider()`,
`toggleProvider()`, and `probeProviderModels()`.

## Consequences

- Bootstrap and settings consumers use `/api/providers` when they require live
  availability and effective settings.
- Provider administration uses `/api/provider-registry` when it requires stored
  configuration or mutation.
- Each route family has one response contract and cannot shadow the other during
  Express dispatch.
- Contract consolidation requires coordinated migration of the daemon,
  desktop client, CLI client, and external API consumers.
- Neither route family decides which provider a turn uses; that selection is
  owned separately (see
  [ADR 0005](adr-0005-turn-provider-selection.md)), and `settings` reports its
  outcome rather than registry order.
