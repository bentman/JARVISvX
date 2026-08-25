# ADR 0003: One authorization context and execution boundary

Status: Accepted
Date: 2026-08-24
Supersedes parts of [ADR 0002](adr-0002-unified-capability-registry.md)

## Context

Authority reached execution through request booleans — `allowCloud`,
`allowToolWrites`, `approved` — that each entry point interpreted for itself.
A client could assert its own approval, several execution paths consulted no
policy at all, and permission classification was inferred from tool names and
from whether a skill happened to be enabled.

Side effects and cloud transmissions arrive from the desktop renderer, the CLI,
slash commands, model tool calls, direct testers, and agent runs. Each needs the
same decision, made in one place, before anything executes.

## Decision

`lib/authorization.mjs` owns the authorization contract. `lib/application.mjs`
creates and propagates it.

**Action classes.** Four actions name every gated operation: `provider.cloud`,
`capability.mutate`, `agent.privileged`, `workspace.write`.

**Turn context.** A chat or agent turn carries one frozen context holding the
grants relevant to that request. Every provider call, capability execution, and
agent run in the turn receives that same context. `authorize(context, {action,
target})` is the one decision mechanism; it returns permission or throws a typed
`AuthorizationError`. A provider adapter, skill body, MCP transport, or client
cannot mark its own operation authorized.

**Daemon approval.** `POST /api/approvals` records an approval for one exact
action and target in `authorization_grants`. A client submits the returned grant
id as `approvals` on its request; the daemon consumes it in the statement that
reads it, so a grant is single-use and expires unused. Request booleans no longer
appear on `/api/chat` or `/api/agents/run`. Two grant targets name a selection
whose concrete value the turn resolves: `auto` for the provider routing selects,
`any` for the mutating capabilities the model calls inside the approved turn.

**Permission classes.** A capability is `read-only` or `approval-required`.
`read-only` bounds both effect and data visibility. MCP tools default to
`approval-required`; `read-only` requires an application-owned declaration about
an application-owned implementation, so a tool name never confers trust. The
read-only SQLite capability selects a named `JarvisDatabase` read model with
validated parameters instead of running SQL, and no read model reaches providers,
encrypted credential columns, settings, or schema metadata.

**Skill provenance.** `skills.execution_provenance` is `application`,
`import_wrapper`, or `user_authored`. An idempotent migration classifies existing
rows by exact match against application-owned implementations and the generated
import wrapper; everything else is `user_authored`. Replacing executable code sets
`user_authored` in the same UPDATE. `application` and `import_wrapper` skills are
read-only and model-callable; `user_authored` skills are `approval-required` and
are withheld from autonomous model invocation while remaining reachable by name.

**Bounded skill execution.** A skill body receives a frozen context exposing named
application operations, not the application object. Its one provider-backed
operation, `generate`, passes through the cloud decision.

**One dispatch path.** Slash invocation, model invocation, the direct MCP and skill
testers, and agent-bus invocation all resolve a capability record through
`lib/capabilities.mjs` and run the same policy check. A skill that fails produces a
failed turn rather than a completed assistant message.

**Approved-root confinement.** `resolveWithinRoots` in `lib/tools.mjs` resolves the
target, or its nearest existing parent, and every root through real-path
resolution, then compares with `path.relative`. Symlinks and Windows junctions are
included. Workspace reads, writes, directory listing, Git tools, and agent working
directories share it, and an empty root set fails closed.

**Agent process authority.** `processModeFor` maps effective capabilities to
`read-only`, `write`, or `shell`. `lib/agents/adapters/acp.mjs` holds an
application-owned table of argument forms per CLI and mode; a pair with no entry
rejects the run with `unsupported_policy` before the process starts. Runs record
the effective adapter and capability set.

**Profile trust.** `DEFAULT_AGENT_PROFILES` and the application-owned
`.jarvis/agents.json` are authoritative for executable wiring. A profile read from
a workspace root may set identity, instructions, voice, capabilities, and an
adapter and CLI drawn from the application allowlists; its command is derived from
the CLI. A profile naming an unknown adapter, CLI, capability, or any
out-of-scope field is rejected with its file path and profile id before it enters
the registry.

**Denial and audit.** A denial reaches no provider, process, endpoint, or write,
and produces the same typed error for every origin. `authorization_audit` records
requested, granted, and effective authority separately from the outcome. Provider
keys, daemon tokens, prompts, and skill source are never authorization evidence.

## Consequences

- One policy decision covers desktop, CLI, voice, slash, model, and agent origins.
- A client that supplies its own approval flag receives nothing; authority exists
  only as a consumed daemon record.
- Approving a mutating capability does not confer agent privilege. Delegating to a
  privileged agent needs both the capability approval and that agent's grant.
- An operator approves each turn separately: the desktop and terminal controls
  clear as the request is submitted, so a failed, cancelled, or successful turn
  leaves nothing enabled.
- Skills a user writes or edits stop being model-callable without approval, and
  the read-only SQLite capability answers only the questions its read models
  declare.
- A workspace with no approved root cannot read, write, list, run Git tools, or
  give an agent a working directory.
- A CLI whose argument surface cannot express the requested capability set is
  refused rather than run with wider authority.
