# ADR 0008: SQLite durability and concurrency

Status: Accepted
Date: 2026-08-26

## Context

`JarvisDatabase` opens SQLite with the library defaults: a rollback journal and
`synchronous = FULL`. Under those settings every statement forces the file
system to flush before it returns, so the cost of a write is a disk
synchronization rather than the work of the query.

The cost is measurable and it is the dominant cost in the project. Opening one
database — creating thirteen tables, seeding the built-in MCP servers, skills,
and memories, and classifying skill provenance — takes 4.5 to 5.0 seconds, and
that price is paid again on every open in the same process. A bare
`DatabaseSync` open costs nothing; a single `CREATE TABLE` plus one `INSERT`
costs 360 ms. Twenty inserts measured on ext4 under WSL2 with Node v24.19.0:

| Configuration | 20 inserts |
|---|---|
| rollback journal, `synchronous = FULL` | 2785 ms |
| `synchronous = OFF` | 0 ms |
| `journal_mode = WAL`, `synchronous = NORMAL` | 0 ms |

The rollback journal also decides how clients share the file. It takes an
exclusive lock for the duration of a write, so a reader blocks until the writer
finishes. The daemon is a long-running process holding an SSE event stream while
the desktop renderer and one or more CLI clients read the same database, which
is the access pattern that lock serializes.

## Decision

`JarvisDatabase` sets `journal_mode = WAL` and `synchronous = NORMAL` when it
opens the database.

**Write-ahead logging.** Writes append to a log alongside the database rather
than rewriting pages in place behind an exclusive lock. Readers see the last
committed state while a write is in progress, so the daemon's writes no longer
block the renderer's and the CLI's reads. `journal_mode` is a property of the
database file and persists once set; `synchronous` is a property of the
connection and is applied on each open.

**`synchronous = NORMAL`.** The database syncs at checkpoints rather than on
every commit. Under WAL this retains durability across a process crash: an
application that dies mid-write loses nothing, because the log is intact and
replays on the next open.

**One setting everywhere.** The pragmas apply to every database the application
opens, including the ones tests construct. A test-only variant would buy suite
time by ensuring tests no longer exercise the configuration the daemon runs
under, which is the opposite of what the tests are for.

## Consequences

- An operating system crash or power loss can lose transactions committed in the
  seconds before the failure. A crash of the application itself cannot. This is
  the durability envelope the assistant now runs under, and it is the whole of
  what `NORMAL` gives up relative to `FULL`.
- Concurrent readers no longer wait for the writer, so the SSE stream, the
  renderer, and the CLI can read while a turn is being persisted.
- The database is now three files: `jarvis.sqlite` plus `jarvis.sqlite-wal` and
  `jarvis.sqlite-shm`. Anything that moves, copies, or backs up the database
  treats all three as one unit. The data-directory migration already moves whole
  directories, so it carries them without change.
- WAL requires shared memory between processes and is unavailable on network
  file systems. SQLite reports that by leaving the journal mode unchanged rather
  than raising, so `JarvisDatabase` reads the mode back and refuses the open with
  `unsupported_storage` when it is not `wal`. A `JARVIS_DATA_DIR` on a network
  share is therefore reported with its remedy instead of running at relaxed
  durability with no log to recover from.
- Repeated database construction stops being the cost centre of the test suite.
  The suite's duration was tracking database opens rather than test count, and
  that relationship no longer holds.
