# Plan: Decompose `database.mjs` into 3 orthogonal modules

## Context

`lib/database.mjs` is 891 lines and mixes six distinct concerns: DDL/schema, migrations,
seeding, encryption, CRUD, and read-model definitions. The codebase values composability and
opposes unnecessary abstractions — the fix is file boundaries at natural seams, not new
interfaces.

**Why now:** The architectural discussion proposed two steps — write integration tests, then
decompose. Exploration shows tests already give 7–8/10 coverage across streaming chat, tool
execution, and auth/grants (`application.test.mjs`, `tool-calling.test.mjs`,
`daemon.test.mjs`, `agent-runtime.test.mjs`). Step 1 is already done. Go straight to the
decomposition.

**Why 3 files, not 10:** The CRUD wrappers (conversations, MCP, skills, memory, providers,
auth) are thin SQL with no independent life — they belong on the class. Only three concerns
are genuinely orthogonal: encryption, migrations, and seeding.

---

## Recommendation: Extract 3 modules

### 1. `lib/encryption.mjs` (~40 lines extracted from lines 853–889)

Self-contained AES-256-GCM helpers with zero coupling to `JarvisDatabase`. Move:
- `readOrCreateSaltFile()`
- `deriveKey()`
- `encryptKey()` / `decryptKey()`

`database.mjs` imports these and calls them where it currently defines them. The provider
CRUD methods (`providerApiKey()`, `_providerRow()`) stay on the class — they just call the
imported helpers.

### 2. `lib/database-migrations.mjs` (~140 lines extracted from lines 132–239)

Schema evolution logic that runs during `migrate()`. Move:
- Full `migrate()` body (table DDL, index creation)
- All semantic migration helpers: `constrainMemoryImportance()`, `recordMcpObservations()`,
  `relateAgentRunsToConversations()`, `correctSeededStackFact()`, `upgradeBuiltInSkills()`

`JarvisDatabase.migrate()` becomes a one-liner that calls the imported function, passing
`this.db` (the raw `DatabaseSync` handle). No new class or interface — just a function that
takes a db handle.

### 3. `lib/database-seeds.mjs` (~150 lines extracted from lines 16–37 and 253–399)

Seed data and first-run initialization. Move:
- Skill code string constants (currently lines 16–37)
- The full `seed()` method body
- `upgradeBuiltInSkills()` if not already in migrations module (check overlap)

`JarvisDatabase.seed()` becomes a one-liner delegating to the imported function, passing
`this.db` and `this.#credentialKey`.

---

## What stays in `database.mjs` (~520 lines after extraction)

- Class definition, constructor, `assertCredentialKeyAvailable()`
- `readModel()` / `readModelNames()` + the 6 read-model definitions (lines 64–72)
- All CRUD methods: conversations, MCP servers, skills, memories, agent runs, providers,
  authorization grants, audit
- Small utilities: `validImportance()`, `boundedLimit()`, `skillProvenanceFor()`, `now()`,
  `id()`, `tryParseJson()`

---

## Files to modify

| File | Change |
|------|--------|
| `lib/database.mjs` | Remove extracted code, add 3 imports at top |
| `lib/encryption.mjs` | New file — extracted crypto helpers |
| `lib/database-migrations.mjs` | New file — DDL + semantic migrations |
| `lib/database-seeds.mjs` | New file — seed data + skill code constants |
| `test/database.test.mjs` | Verify existing tests still pass; add direct unit tests for encryption helpers if none exist |

No other files change — `database.mjs` is not re-exported through an index; callers import
the class directly and the class API is unchanged.

---

## What this is NOT

- Not splitting CRUD into per-entity files (`db-conversations.mjs`, `db-skills.mjs`, etc.) —
  those are thin SQL with no independent life; splitting them creates artificial interfaces
- Not touching `application.mjs` (26.6KB) — its concerns are more tightly coupled; splitting
  would produce artificial seams
- Not reopening the authorization grant design — that's an ADR question, not a code change

---

## Verification

1. `npm test` — full suite must stay green; no behavior changes
2. `node bin/jarvis.mjs` — daemon starts, first-run seed runs, encryption round-trips
3. Spot-check: add a provider with an API key, restart daemon, confirm key decrypts correctly
   (exercises the extracted encryption path end-to-end)
