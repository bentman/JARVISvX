# ADR 0001: Split `/api/providers` and `/api/provider-registry`

Status: Accepted
Date: 2026-08-18

## Context

`lib/api.mjs` originally registered a single `GET /providers` route returning
a `{ settings, providers }` shape used by the Settings panel and health
checks. When the provider-registry feature (DB-backed providers with tags,
priority, and CRUD) was added, its list/create endpoints were also mounted
at `/providers`. Express dispatches to the first matching route handler, so
the registry's `GET /providers` was silently shadowed by the legacy route —
the registry-list endpoint was dead code from the moment it was added, and
nothing surfaced the bug because both routes returned JSON with no shape
validation on the client.

This was found and fixed under the "app fragmentation" tech-debt audit
(`docs/tech-debt-fragmentation-audit.md`, finding on route collisions) as
part of an earlier "fix it without breaking anything else" pass.

## Decision

Keep both route families, but give them distinct, non-overlapping base
paths:

- `GET /api/providers` — unchanged. Health-checked provider summaries for
  Settings and diagnostics: `{ id, label, available, models, reason?, tags?,
  priority? }[]`. Cheap to call repeatedly; does not require DB write access.
- `/api/provider-registry` — new. Full CRUD over the `providers` table:
  `GET /` (list), `POST /` (create), `GET /:id`, `PUT /:id`, `DELETE /:id`,
  `POST /:id/test`, `POST /:id/toggle`. This is the source of truth for
  provider configuration; the Providers admin view uses these exclusively.

`src/api.ts` mirrors the split: `providerHealth()` calls `/api/providers`,
while `listProviders()`, `createProvider()`, `updateProvider()`,
`deleteProvider()`, `testProvider()`, and `toggleProvider()` call
`/api/provider-registry`.

## Consequences

- No more silent route shadowing — the two concerns (a fast health summary
  vs. authoritative CRUD) are addressed at genuinely different URLs.
- Frontend code must pick the right client method for the job; `providers()`
  intentionally no longer exists as a single ambiguous export in `src/api.ts`
  to make that choice explicit at each call site.
- Any external tooling or scripts that called the old registry-shaped
  `GET /providers` (if any existed, given it never actually worked) must be
  updated to `GET /provider-registry`. The health-check shape at
  `GET /providers` is unchanged and remains backward compatible.
