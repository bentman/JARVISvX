# ID and CRUD conventions

This document covers the id-generation and REST-route conventions new code
should follow. Existing ids and routes are unaffected.

## IDs

Use `crypto.randomUUID()` for anything new. It's already how conversations,
messages, workspace roots, agent runs, and SSE event ids are generated
(`lib/database.mjs`'s `id()` helper, `lib/event-hub.mjs`). It needs no
scheme to remember, has no collision math to get wrong, and every runtime
this project touches (Node, the browser, Electron) has it built in.

Two other schemes are in use for existing resources and are not being
changed:

- `` `prefix-${Date.now()}-${Math.floor(Math.random() * N)}` `` — used for
  providers, memories, MCP servers, skills, and workspace edits
  (`lib/database.mjs`). `N` varies across these (1000 for most, 10000 for
  providers).
- Fixed semantic slugs (`architect`, `reviewer`, `researcher`, ...) for the
  built-in agent profiles (`lib/agents/registry.mjs`). Agent ids are
  referenced by name in prompts, CLI commands, and config, so a
  human-readable slug is the right choice for this small, fixed,
  human-authored set. Don't reuse this pattern for resources that aren't a
  small, fixed, human-authored set.

## Status codes

Every resource route answers with the same vocabulary, defined in
`lib/contracts.mjs` and applied by `lib/api.mjs`:

| Situation | Status | `code` |
|---|---|---|
| Unknown id on lookup, update, toggle, delete, approve, reject | 404 | `not_found` |
| A state transition the record does not allow | 409 | `conflict` |
| Invalid request data | 400 | `validation` |
| Missing authorization for the operation | 403 | `approval_required` |

A delete of something that is not there is a 404, not a 200 reporting that
nothing was removed.

## REST shapes

Four shapes for "manage a list of things" coexist:

- Plain CRUD — `GET/POST /memory`, `PUT/DELETE /memory/:id`.
- CRUD + toggle — `/provider-registry`, `/skills`, each adding a
  `POST /:id/toggle` for an enabled/disabled flip.
- CRUD + search — `/memory` also has `POST /memory/search`.
- Action-verb endpoints — `/workspace-edits/propose`,
  `/workspace-edits/:id/approve`, `/workspace-edits/:id/reject`, where the
  resource's state machine (pending → approved/rejected) doesn't map
  cleanly onto a single `PUT`.

Default to plain CRUD. Reach for one of the other three only when the
resource genuinely needs it:

- Add `POST /:id/toggle` when there's a real enabled/disabled flag on the
  resource — use `PUT` for everything else.
- Add `POST /search` alongside CRUD when the list is large enough that
  client-side filtering of `GET /` stops being reasonable.
- Reach for action-verb endpoints only when the resource has an actual
  state machine with side effects beyond "some fields changed" — approving
  a workspace edit writes a file; that's not a `PUT`.

## Applying this

When a change touches a new resource type or adds an id, check it against
the above before merging.
