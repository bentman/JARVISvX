# SQLite and data-directory observations

Lifecycle: Informational

Measurements taken on the current tree. This document reports observed behavior
and one optimization that has not been applied; it defines no requirement.

## Test suite duration

`npm test` runs the Node test runner with `--test-concurrency=1`, so every test
file executes serially.

| Tests | Duration |
|---|---|
| 126 | 373–415 s |
| 135 | 379 s |
| 140 | 400 s |
| 148 | 428 s |
| 155 | 449 s |
| 158 | 454 s |

Duration tracks test count at roughly 5 s per added test. The suite was already
above six minutes at 126 tests.

## Where the time goes

The cost is `JarvisDatabase` construction, not query volume. The suite performs
57 constructions: 54 direct `new JarvisDatabase(...)` calls in tests plus 3 from
`startDaemon()`. Every `createJarvisApp()` call in the suite supplies an existing
database and adds none.

Each construction costs 4.5–5.0 s, and the cost does not amortize — the second
and third construction in one process cost the same as the first.

| Phase | Cost |
|---|---|
| `migrate()` total | 4850 ms |
| — initial `CREATE TABLE IF NOT EXISTS` batch (13 tables) | 2180 ms |
| — `seed()` (3 MCP servers, 6 skills, 4 memories) | 1870 ms |
| — `classifySkillProvenance()` | 800 ms |
| — the three guarded table rebuilds | 0 ms |

The guarded rebuilds are no-ops on a fresh database and contribute nothing.

## The cause is durability settings, not SQLite

A bare `DatabaseSync` open costs 0 ms. A single `CREATE TABLE` plus one `INSERT`
costs 360 ms. Every individual statement pays roughly 100–300 ms, which is disk
synchronization rather than query work.

Measured on ext4 under WSL2, Node v24.19.0:

| Configuration | 20 inserts |
|---|---|
| default (rollback journal, `synchronous=FULL`) | 2785 ms |
| `synchronous=OFF` | 0 ms |
| `journal_mode=WAL`, `synchronous=NORMAL` | 0 ms |

SQLite's default is `synchronous=FULL` with a rollback journal, so each statement
forces multiple fsyncs. Migration and seeding together issue roughly forty
statements.

## Possible optimization — not applied

Setting `journal_mode = WAL` and `synchronous = NORMAL` in the `JarvisDatabase`
constructor would remove nearly all of this cost. WAL also permits concurrent
readers alongside a writer, which suits a long-running daemon with an SSE stream
and CLI clients against one database.

The trade is a durability change to the running application, not only to tests.
Under WAL, `NORMAL` remains durable across a process crash; only an operating
system crash or power loss can lose recently committed transactions. Applying it
is an architecture decision about persistence guarantees and belongs in an ADR
rather than in a phase's implementation work.

A test-only variant — applying the pragmas when a caller supplies an explicit
`dbPath` — would recover the suite time without changing production durability,
at the cost of tests no longer exercising the settings the daemon runs under.

## Operator data directory

`<project>/data` is the operator's durable storage. It is untracked by design
(`.gitignore` excludes `data/**`), and `JARVIS_DATA_DIR` relocates it.

Relocation **moves** the directory. `startDaemon()` calls `migrateDataDirectory()`
before opening SQLite, and that function renames the source onto the destination,
falling back to copy-then-remove across filesystems. The move is atomic and
preserves arbitrary contents: a round trip out to another root and back was
verified to carry both database rows and unrelated files placed in the directory.

The operational consequence is that **any** process started with
`JARVIS_DATA_DIR` pointing somewhere other than `<project>/data` relocates the
operator's directory there — including a headless daemon, a CLI invocation, or a
test harness. The interactive import/overwrite prompt described in
`.env.example` exists only on the desktop path; every other caller takes the
documented non-interactive policy. A directory relocated this way is not lost,
but it is no longer where an operator who did not set the variable would look.

Two options for an Architect to weigh, neither applied:

- Leave as is. Relocation-by-move is the stated purpose of the mechanism, and the
  variable is operator-set.
- Require the destination to be explicit for non-interactive callers, so a
  transient environment variable cannot relocate the durable directory as a side
  effect of an unrelated run.
