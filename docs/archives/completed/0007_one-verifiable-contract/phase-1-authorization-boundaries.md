# Phase 1: Authorization and execution boundaries

Lifecycle: Planned

## Required outcome

Every side effect and cloud transmission is authorized by a daemon-owned
policy before execution. Desktop, CLI, slash-skill, model-tool, direct-tool,
and agent entry points provide authorization context to that policy and do not
implement independent bypasses.

## Dependencies

This phase has no implementation dependency. It establishes contracts used by
all later phases.

## Ownership

- `lib/application.mjs` owns turn authorization and propagation.
- `lib/capabilities.mjs` owns capability metadata and permission
  classification.
- `lib/database.mjs` owns protected-data read models and persisted skill
  execution provenance.
- `lib/mcp-skills.mjs` owns skill and MCP execution adapters.
- `lib/agents/policy.mjs` and `lib/agents/adapters/` own agent authorization
  and process confinement.
- `lib/tools.mjs` owns approved-root path resolution.
- `lib/api.mjs`, `src/api.ts`, `src/App.tsx`, and `bin/jarvis.mjs` carry the
  authorization contract across each client boundary.

## Requirements

### P1-R01: Turn authorization context

The application layer shall create one immutable authorization context for
each chat or agent turn. It contains the operator grants relevant to the
request, including cloud transmission, mutating capability execution, and
privileged agent execution. Every provider call and capability execution made
during that turn receives the same context.

The application layer shall expose one policy decision mechanism that accepts
the requested action and authorization context and returns either permission
or a typed denial. Entry points call this mechanism before execution. A
provider adapter, skill body, MCP transport, or client cannot mark its own
operation authorized.

The daemon shall record approval for one exact operation and consume it before
execution. The approval is bound to the requested action and selected target
and expires without reuse. Request booleans such as `approved`, `allowCloud`,
or `allowToolWrites` do not authorize work without that daemon record.

### P1-R02: Cloud transmission gate

Every call to a provider tagged `cloud` shall require the current turn's cloud
grant. This includes ordinary chat, `/code`, any future provider-backed skill,
agent model calls, panel/debate synthesis, tool-loop continuation, and retry
requests.

A denial shall occur before request serialization or network access and shall
produce the same typed application error and user-facing event for every
origin.

### P1-R03: Per-turn client grants

Desktop approval controls represent the next accepted turn. Each desktop and
terminal request path shall snapshot the applicable grants and clear them
synchronously when it submits the request, before awaiting stream or agent
completion. This applies to chat, direct agent, panel, and debate requests. A
failed, cancelled, or successful operation therefore cannot leave approval
enabled for a later operation.

### P1-R04: Capability permissions

Each capability shall declare one permission class:

- `read-only`: execution observes state within its declared boundary.
- `approval-required`: execution can mutate state, launch a process with
  mutation authority, transmit to a cloud provider, or perform an operation
  whose effects are not proven read-only.

MCP tools default to `approval-required`. A tool is `read-only` only when
trusted server metadata or an application-owned declaration identifies it as
read-only. Tool names are descriptive metadata and are not an authorization
mechanism.

The direct MCP tester, slash invocation, model invocation, and agent-bus
invocation shall dispatch through the same capability record and policy check.

A `read-only` classification shall define both an effect boundary and a data
visibility boundary. A read operation may expose only the records and fields
declared by its contract. The SQLite `execute_query` capability shall not
provide arbitrary access to application tables, encrypted credential columns,
settings secrets, or unrestricted schema metadata. It shall use allowlisted
queries or application-owned read models that omit protected data. Those read
models shall be methods on `JarvisDatabase`; capability input shall select a
named model and validated parameters.

### P1-R05: Custom skill execution

Every executable skill shall run through a bounded application interface that
exposes only the operations declared by the skill's permission metadata. The
unrestricted application object and ambient filesystem/process authority shall
not be the skill API.

User-authored skill code and skill code replaced through the update API shall
be classified `approval-required` and excluded from autonomous model
invocation until bounded execution is available. An imported skills.sh record
may remain read-only only while it retains the application-generated wrapper
that returns escaped instruction prose. Skill provenance and whether executable
code has been replaced shall be represented explicitly enough for the
dispatcher to enforce this distinction. Application-owned built-in skills may
be autonomous when their implementation and declared effects satisfy the
`read-only` contract.

The `skills` schema shall contain a non-null `execution_provenance` value with
the values `application`, `import_wrapper`, and `user_authored`. Updating
executable code shall set the effective provenance to `user_authored` in the
same transaction. The idempotent migration shall classify existing rows
conservatively: only an exact application-owned implementation receives
`application`, and only an exact generated wrapper receives `import_wrapper`;
every other existing row receives `user_authored`.

Skill execution failures shall return a failed tool or turn result. The
application shall not persist or present an unsuccessful skill result as a
successfully completed assistant turn.

### P1-R06: Agent process authority

An agent adapter shall translate the selected profile capabilities into the
narrowest supported process mode, working directory, and approval flags.
Read-only profiles run without automatic edit acceptance or workspace-write
authority. Profiles requiring mutation run only with the current agent grant.

When a target CLI cannot enforce the requested capability set, the adapter
shall reject the run with a typed unsupported-policy error before spawning the
process. Recorded run metadata shall include the effective adapter and
capability set.

### P1-R07: Approved-root confinement

Reads and writes shall resolve the target and the existing nearest parent
through filesystem real-path resolution. The resolved target shall remain
inside a resolved approved root. Symlinks and Windows junctions are included
in this check.

Workspace tools require at least one approved root. The process working
directory does not become an implicit approved root. Git workspace tools use
an explicitly selected approved root as their working directory.

`lib/tools.mjs`, built-in workspace/MCP execution, and agent working-directory
selection shall use one shared resolved-root function. A zero-root state fails
closed for file reads, directory listing, Git operations, writes, and agent
workspace access.

### P1-R08: Denial behavior and audit evidence

Authorization denial shall not invoke a provider, spawn a process, execute
skill code, call an MCP endpoint, or write a file. The daemon shall emit a
stable approval-required or policy-denied result that identifies the action
class without exposing secrets.

Audit records shall distinguish requested authority, granted authority,
effective authority, and denial. Provider keys, daemon tokens, prompts marked
sensitive, and raw skill source shall not be logged as authorization evidence.

### P1-R09: Agent profile trust

Approved workspace roots grant the read and write capabilities represented by
workspace policy; they do not grant authority to define executable commands or
arguments. The registry therefore reads agent profiles from exactly two
sources: the built-in `DEFAULT_AGENT_PROFILES` in `lib/agents/registry.mjs`,
and the single override file at `agentConfigPath` under the data root. No
profile is read from a workspace root, so an approved directory cannot
introduce a command by any path.

The override file may set identity, description, voice, instructions,
capabilities, and an adapter and CLI identifier drawn from the application
allowlists. `command` follows the CLI identifier rather than the file. Process
arguments and every other field are outside an override's scope. A profile that
names an unknown adapter, CLI, or capability, that sets a `command`
disagreeing with its CLI, or that sets an out-of-scope field is rejected with
its file path and profile ID before any process can spawn. Runtime-path
relocation of `agentConfigPath` occurs in Phase 2 without changing this trust
precedence.

## Implementation targets

- `lib/application.mjs`
- `lib/capabilities.mjs`
- `lib/database.mjs`
- `lib/mcp-skills.mjs`
- `lib/tools.mjs`
- `lib/agents/policy.mjs`
- `lib/agents/registry.mjs`
- `lib/agents/coordinator.mjs`
- `lib/agents/adapters/acp.mjs`
- `lib/agents/adapters/process.mjs`
- `lib/api.mjs`
- `src/api.ts`
- `src/App.tsx`
- `src/components/McpSkillsView.tsx`
- `src/components/AgentOrchestrationView.tsx`
- `bin/jarvis.mjs`
- `test/tool-calling.test.mjs`
- `test/mcp-skills.test.mjs`
- `test/agent-runtime.test.mjs`

## Implementation sequence

1. Define one daemon-owned authorization context, one-turn approval, and typed
   denial shared by every entry point.
2. Route ordinary provider calls and provider-backed skills through the cloud
   decision.
3. Add explicit capability metadata, protected database read models, and the
   skill-provenance migration.
4. Restrict custom skill context and align every skill/MCP entry point with the
   shared dispatcher.
5. Map profile capabilities to adapter process modes and reject unsupported
   mappings.
6. Replace lexical workspace containment checks with one shared resolved-root
   check and make every zero-root workspace path fail closed.
7. Restrict agent-profile trust sources and validate executable wiring during
   registry load.
8. Clear client approval when the request is submitted and normalize denial UI.
9. Add an ADR describing the authorization context, permission classes, and
   execution boundary. The new ADR shall supersede ADR 0002's decisions that
   enabled skills execute autonomously and that unannotated MCP tools may be
   inferred read-only. ADR 0002 shall identify the superseding ADR in its
   status and consequences.

## Verification

Focused tests shall cover the boundaries where a mistake creates authority:
cloud transmission, mutating MCP or skill execution, privileged agents,
protected database reads, and workspace-root confinement. Each denial test
asserts that no provider, process, endpoint, or write was reached; one allowed
case per boundary proves the intended operation still works.

Approval checks shall cover single use, expiry, target mismatch, and a client
that supplies `approved: true` without daemon approval. Confirm by inspecting
`src/App.tsx` and `bin/jarvis.mjs` that each submit path clears its approval
state before awaiting the response.

Run:

```text
node --test test/tool-calling.test.mjs
node --test test/mcp-skills.test.mjs
node --test test/agent-runtime.test.mjs
npm run lint
```

## Exit conditions

Phase 1 is complete only when:

- every provider and executable capability entry point calls the shared policy;
- custom skill code has no unrestricted application or ambient mutation API;
- read-only agent profiles cannot spawn an edit-enabled process;
- workspace agent profiles cannot introduce arbitrary commands or arguments;
- read-only SQLite capabilities cannot expose protected application fields;
- skill provenance changes when executable code changes;
- daemon approval is target-bound, expiring, and single-use;
- real-path confinement handles link escapes and an empty root set;
- client approval clears per submitted turn; and
- the focused authorization, skill, and agent checks pass.
