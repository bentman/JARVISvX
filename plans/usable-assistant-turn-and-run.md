# Plan: Make a turn produce an answer, and an agent run finish

## Context

The daemon, provider routing, tool registry, voice loop, and agent runtime all work in
isolation and are covered by tests. Driving them from the desktop and the CLI fails in
three places, none of which any test exercises: a tool-using turn returns nothing and
records nothing, a multi-agent run cannot complete inside its own HTTP request, and
workspace search spends its budget on the application's own cache directory.

Every item here is one defect: the system states something it does not do. Tool results
are reported and not stored. A debate reports failure after completing. `.agentignore`
declares what search skips and is never read. A truncated search presents itself as
complete. A profile declares read-only capabilities and its run writes files.

Each item below names the file, the evidence, and what "fixed" looks like. They are ordered
so the cheapest work comes first; order is sequencing, not priority.

---

## Tool-using turns

**Persist tool results into the assistant message.** `lib/application.mjs:290-300` streams
tool calls and their results as SSE events, and builds the stored message from `content`
pieces only. A turn that spends every round calling tools and emits no prose is saved as
nothing but the round-limit notice, so reopening the conversation shows an empty answer
where work was done. Tool calls and their results belong in the persisted turn.
Fixed: reopening a conversation shows what the tools returned.

**Name the read models in the `execute_query` schema.** `lib/database.mjs:291` describes the
parameter as "a read-model name" without listing the names, so a model discovers them only
by failing. The seven names are static and belong in the schema as an enum, the way
`agents_ask` already constrains `targetAgentId`. Fixed: asking for agent runs costs one
round, not three.

**Report the remaining tool-round budget to the model.** `MAX_TOOL_ROUNDS` is 4
(`lib/application.mjs:16`) and nothing tells the model how many rounds remain, so it cannot
choose between another call and answering with what it has. Fixed: the tool result carries
the remaining budget.

**Answer from what was gathered when the budget runs out.** Reaching the cap currently ends
the turn with a notice and no content. The final round should ask for a summary of what the
earlier rounds found. Fixed: a capped turn still answers.

**Confirm whether the round-limit notice renders twice.** It appeared twice in one CLI turn.
The loop emits it once, so the duplicate is in rendering — the streamed content and the
final message are both appended. Unverified.

## Agent runs

**Return a run id instead of holding the request open.** `lib/api.mjs:95` answers
`POST /agents/run` with the completed run, so the client waits for every participant. Node's
`fetch` abandons a request after 300s (`undici` default `headersTimeout`), and each agent
process is allowed 300s (`lib/agents/adapters/acp.mjs:182`), so a client cannot outlast even
one slow participant, and a debate runs several in sequence. The run record and the SSE
stream the client already subscribes to carry everything needed to follow it.

This discards completed work, not just slow work. A three-participant debate whose client
reported `fetch failed` had in fact run to completion, each participant finishing minutes
apart; the result was written to the run record and never reached the caller.
Fixed: `/debate` with two agents completes and reports.

**Surface `error.cause` where requests fail.** The TUI catch sites render `error.message`
alone, and `fetch` reports every network-level failure as `fetch failed`. The reason —
`HeadersTimeoutError`, a refused connection — lives in `cause`. Fixed: a failed request names
what actually happened.

**Give agent runs a surface.** `GET /api/runs` exists and nothing calls it: no CLI
subcommand, no slash command, no desktop panel. Fixed: a completed or failed run can be read
back without a raw HTTP request.

## Agent process authority

**Reconcile declared capabilities with the authority a spawned CLI actually has.**
`architect` and `reviewer` declare `capabilities: ['workspace.read', 'git.read']`
(`lib/agents/registry.mjs`), which maps to `--permission-mode plan` for `claude` and
`-s read-only` for `codex`. A debate run under those profiles created three files in a
`plans/` directory that did not previously exist. Either the capability-to-mode mapping is
not reaching the spawned process, or these CLIs write planning artifacts regardless of the
sandbox mode they are given. Establish which, in that order: the first is a defect in the
boundary this project treats as authoritative, the second is a property of the tools that
the capability model has to account for rather than assume away.
Fixed: a read-only agent run leaves the workspace unchanged, or the profile declares the
authority the run actually exercises.

## Workspace search

**Skip the application's own runtime directories.** `SEARCH_SKIP_DIRS`
(`lib/tools.mjs:52`) lists `.cache` but not `cache`, `data`, or `models`, so a search walks
Electron's Chromium cache and returns minified bundle fragments. Results are capped at 20
and the scan at 4000 files, so cache contents displace real matches and can exhaust the scan
before reaching source. Fixed: a search for a symbol returns source files.

**Apply `.agentignore`.** The file exists at the repository root and `searchWorkspace` never
reads it. Fixed: the ignore file governs what search walks, or it is removed.

**Tell the model when results are truncated.** `searchWorkspace` computes `truncated` and the
tool output drops it, so a partial search reads as a complete one. Fixed: a truncated search
says so in its result.

## Coverage

**Exercise the surfaces from outside.** Every failure here sits between components that pass
their own tests. `DaemonClient.connect()` now accepts a resolved path set and has one attach
test; a tool-using turn, an agent run, and a search have no equivalent. Fixed: a test drives
a turn through tool rounds to a stored answer, and a run to a terminal record.
