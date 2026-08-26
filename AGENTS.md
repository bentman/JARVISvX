# AGENTS.md

Operating contract for agents (human or AI) working in this repository.
Explicit instructions for the current task always override this file.

## Project

Node.js 24+, ESM (`"type": "module"`). An Express daemon (`lib/daemon.mjs`)
owns SQLite state and an SSE event bus shared by an Electron voice host and
the `jarvis` CLI. See `README.md` for architecture and `ProjectVision.md`
for product intent.

## Commands

- `npm install` — install dependencies
- `npm run build` — Vite build → `dist/`
- `npm run dev` — start the daemon only (`server.mjs`, port 3210)
- `npm test` — full Node test-runner suite
- `node --test test/<file>.test.mjs` — a single test file
- `npm run lint` — `tsc --noEmit`

## Principles

- KISS: the smallest design that satisfies the current requirement.
- YAGNI: no new provider, table, service, or abstraction before a caller
  needs it.
- DRY: one shared implementation per contract — extend `lib/providers/`,
  don't fork it.
- Idempotent: re-running a command or migration is safe and converges to
  the same state.
- Deterministic: tests avoid hidden network, clock, or random dependencies
  unless explicitly marked live.
- Existing patterns first: match the conventions already in the file
  you're editing before introducing a new one.
- Don't guess: verify against the repo — grep, read the file, run the
  command — before making a claim about current behavior.
- Don't expand scope beyond the request; propose unrelated fixes
  separately rather than folding them in silently.

## Documentation and code

- Source code and tests describe the system as it exists. Development
  narration belongs in chat, commits, pull requests, or durable ADRs.
- Default to no comment. A comment survives only when it explains a
  non-obvious invariant, constraint, workaround, or public contract.
- Source artifacts contain no conversation or session residue. Comments,
  docstrings, documentation, and tests never reference the development task,
  coding agent, authoring conversation, implementation phase or diff, previous
  implementation, temporary planning document, or completed-work document.
- Positive scope boundaries — say what a module does and which mechanism
  owns it, not what it "is not."
- Just-in-time cross-references — link between docs only in hub sections
  (README's Architecture/Storage tables, an ADR's own Consequences), and
  only where acting correctly requires reading the target.
- Non-trivial architecture decisions get a short ADR at
  `docs/adr/adr-NNNN-<slug>.md`: context, decision, consequences. This repo
  does not keep a changelog or capability inventory — git history and the
  current code are the record.

## Security

- Cloud-tagged provider turns require explicit per-turn approval
  (`allowCloud` / `/approve-cloud`) — never add a routing path that
  bypasses this gate.
- Workspace tools stay read-only (approved root, UTF-8, 1 MiB cap); adding
  a write or execute path is an ADR, not a quiet extension.
- Provider API keys are stored only through `lib/database.mjs`'s existing
  encrypted column — never logged, never persisted elsewhere.

## Testing

- Scope verification to the blast radius of the change: a comment- or
  docstring-only edit needs `npm run lint` at most; a change to one module
  needs just its test file; reserve the full `npm test` run — on Windows and
  Linux both — for a natural milestone (end of a phase, before reporting a
  task done), not every intermediate edit.
- A test earns its place by failing when the behavior it names is broken.
  Name that failure in one line, or don't add the test.
- A test constructs the state it needs. Never assert on ambient state — the
  working tree, a free port, an absent service, an environment variable the
  test did not set — and close every handle it opens on the success and
  failure paths.
- When a test goes red the code is wrong until shown otherwise; changing the
  test to make it pass requires stating what it asserted incorrectly.
- Extend or parameterize an existing test unless the case is a distinct
  contract, branch, boundary, or regression the existing shape can't express.
- A failure traced to the execution environment (a sandboxed filesystem
  that can't delete files, a native module built for the wrong OS/arch) is
  reported as an environment artifact with its root cause, not silently
  skipped or treated as a regression.
- Don't rerun an unchanged passing command, and don't repeat a failing one
  with nothing changed — diagnose it or report the blocker.

## Reporting

- Calibrate the summary sentence to the weakest verified claim in the same
  report, not the strongest. If something was checked by unit test only, say
  so in the summary line itself, not buried in a caveat underneath.
- Show the evidence — the command, the platform, and what it covered. Test
  count and repeated green runs are not completion evidence.

## Git

Local, reversible operations — commit, `git rm --cached`, dry-run checks
like `git merge-tree` — are fine to run directly. `git push`/`git pull`/
`git merge` against `origin`, and any history rewrite (`reset --hard`,
`rebase`, `clean -f`), are the repo owner's to run or explicitly approve
first.
