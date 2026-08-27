# Plan: Extract Natural Seams from database.mjs

## Context

`lib/database.mjs` is 891 lines / 52KB and mixes DDL, migrations, seed data, encryption helpers, and CRUD for 10+ entity types. It's the clearest design violation in the codebase and the highest-leverage target. The natural seams (encryption, migrations, seeds) are already well-defined — this is file-boundary work, not new abstraction work.

## Critique of the Architect's Position

**Test coverage claim is wrong.** The codebase has 23 test files (~4,340 lines) with substantial integration coverage:
- `application.test.mjs` — streaming chat, provider routing, slash skills, memory context
- `tool-calling.test.mjs` — tool loop, approval gates, agent delegation, cloud auth
- `daemon.test.mjs` — SSE streaming, auth, lifecycle, token security

Step 1 (add chat flow integration tests) is unnecessary — they exist. Skip it.

**The 10-file decomposition is too aggressive.** The CRUD methods for conversations, workspace, MCP, skills, memory, agents, providers, and settings are thin SQL wrappers that belong on the class. Splitting them into per-domain files creates artificial module interfaces with no real seam. Simpler: extract only the 3 concerns that are genuinely orthogonal.

**Authorization split is already correct.** `authorization.mjs` holds the policy/runtime layer; `database.mjs` holds the 4 persistence methods (`issueGrant`, `consumeGrant`, `recordAuthorization`, `authorizationAudit`). This boundary is working — don't disturb it.

**`application.mjs` at 385 lines is not the right target.** The 150-line `chat()` generator is tightly coupled through closures to `db`, `registry`, `voice`, `agentRuntime`, `grants`, and `events`. Splitting it would produce artificial interfaces. Agreed with architect: not yet.

## Recommended Approach

Extract exactly 3 modules at the strongest, most independent seams. No new abstractions — just file boundaries.

### 1. `lib/encryption.mjs` (new file)

Extract lines 859–891 of `database.mjs`:
- `readOrCreateSaltFile()` — reads/generates `provider.key` from disk
- `deriveKey()` — SHA-256 from salt
- `encryptKey()` — AES-256-GCM encrypt
- `decryptKey()` — AES-256-GCM decrypt
- The deferred `import crypto` moves here permanently

Zero coupling to the rest of `database.mjs`. `database.mjs` imports it. The existing `assertCredentialKeyAvailable()` function (lines 75–109) also moves here since it depends only on encryption + fs.

### 2. `lib/database-migrations.mjs` (new file)

Extract lines 132–251 of `database.mjs`:
- `runMigrations(db)` — exported function wrapping the full `migrate()` body
- All DDL (`CREATE TABLE IF NOT EXISTS` block — 11 tables)
- All semantic migration helpers: `upgradeBuiltInSkills()`, `correctSeededStackFact()`, `constrainMemoryImportance()`, `recordMcpObservations()`, `relateAgentRunsToConversations()`, `classifySkillProvenance()`

`JarvisDatabase` constructor becomes: `migrate(db)` → `runMigrations(db)`.

### 3. `lib/database-seeds.mjs` (new file)

Extract lines 15–72 (skill code constants) and 253–399 (seed logic) of `database.mjs`:
- Skill code templates: `SEARCH_SKILL_*`, `CALC_SKILL_*`, etc.
- `seedDatabase(db, env)` — exported function wrapping `seed()` + `seedProvidersFromEnv()`
- `READ_MODELS` constant (lines 64–72) stays in `database.mjs` since `readModel()` is a class method used directly

`database.mjs` imports the skill code templates for `upgradeBuiltInSkills()` — or that helper moves to `database-migrations.mjs` with the templates imported there.

## Files Modified

| File | Action |
|------|--------|
| `lib/database.mjs` | Remove extracted sections, add 3 imports |
| `lib/encryption.mjs` | New — ~45 lines (encryption + assertCredentialKeyAvailable) |
| `lib/database-migrations.mjs` | New — ~120 lines |
| `lib/database-seeds.mjs` | New — ~200 lines (constants + seed logic) |

## What Does NOT Change

- All public exports from `database.mjs` (`JarvisDatabase`, `dataDirectory`, `resolveDataDirectory`, `MEMORY_IMPORTANCE`, `skillProvenanceFor`, `UnsupportedStorageError`)
- All callers of `database.mjs` — this is internal reorganization only
- Test files — no behavior changes

## Verification

```bash
# Run full test suite — no regressions
node --test

# Confirm database opens and seeds correctly on fresh data dir
JARVIS_DATA_DIR=/tmp/jarvis-test node bin/jarvis.mjs --version

# Check that encryption still works (providers with API keys)
node --test test/database.test.mjs
node --test test/provider-registry-routes.test.mjs
```
