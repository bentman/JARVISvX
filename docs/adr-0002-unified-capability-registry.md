# ADR 0002: Unified capability registry for conversational tool use

Status: Accepted
Date: 2026-08-19

## Context

`lib/application.mjs`'s `chat()` sends `{ messages, model, signal }` to a
provider's `streamChat()` and nothing else. None of the four provider
protocols (`openai-compat`, `ollama`, `anthropic`, `gemini`) accept or send
a `tools` parameter, so a model can never see or invoke anything during
ordinary conversation.

Meanwhile the app already has real capabilities, each reachable only
through its own separate path: workspace tools (`lib/tools.mjs`), MCP
server tools (`lib/mcp-skills.mjs`'s `executeMcpTool`, sourced from each
server's `tools_json`), skills (`db.skillByCommand`, matched against a
`/command` prefix before the model ever sees the message), and agents
(`agentRuntime`, dispatched only via an explicit `@agent` mention). Three
independent lookup mechanisms for what is conceptually one thing: what
JARVIS can do right now.

`ProjectVision.md` describes "Agent Orchestration: Coordinates complex
tasks through an integrated toolbox" and a single assistant reachable
uniformly across GUI, CLI, and voice. The GUI (`src/`) and CLI
(`bin/jarvis.mjs`, via `DaemonClient`) already call the same
`POST /api/chat` route into the same `chat()`, so this is one
implementation surface, not two.

## Decision

Introduce one capability registry enumerating workspace tools, each
server's declared MCP tools, enabled skills, and available agent
profiles. Three entry points read from the same registry instead of each
keeping its own lookup: the tool schema handed to a provider for
autonomous invocation, the existing `/slash` matcher, and the existing
`@agent` dispatcher. A skill or MCP tool becomes reachable by the user
typing `/calc`, or by the model invoking it mid-conversation — same
underlying call.

Execution is gated by each capability's existing trust level; no new
approval mechanism is introduced:

- Read-only workspace and MCP tools execute immediately.
- Tools that write or execute directly (`write_workspace_file`, mutating
  MCP tools) surface an approval-required event, the same shape the
  workspace-edit propose/approve flow already uses.
  `propose_workspace_edit` itself executes immediately without that
  gate — it never touches the filesystem, only stages a `pending_review`
  row, and the existing approve/reject flow is the actual human
  checkpoint for the write.
- Skills execute directly once model-invoked, gated only by their
  existing `enabled` flag — they are pre-authored and stored by the user,
  not arbitrary untrusted code.
- Agent delegation routes through the existing `executeAgentRun()`, gated
  by the same `approved`/`allowCloud` flags `@agent` already requires.
  Missing approval produces an approval-required event rather than a
  silent block or a silent bypass.

A short system message summarizing the registry (available tools, MCP
servers, skills, and that specialist agents can be brought in) is added
ahead of conversation history, so a model without structured tool-calling
support can still describe what's available accurately instead of
denying it.

## Delivery

Each provider protocol needs its own tool-call wire format (OpenAI-style
`tools`/`tool_calls` deltas, Ollama's native `tool_calls`, Anthropic's
`tool_use` content blocks, Gemini's `functionCall` parts) — bounded,
per-protocol work matching the SSE parsing each provider file already
does independently.

**Phase A — shipped.** `lib/capabilities.mjs` builds the registry from
MCP-declared tools plus the two core app tools. `lib/application.mjs`'s
`chat()` runs the bounded tool-call loop (workspace and MCP tools only)
against it. `openai-compat` and `ollama` gained a `supportsToolCalling`
flag (`lib/providers/base.mjs`, overridden per protocol) that gates the
whole capability registry, the tool schema, and the system-prompt
summary off entirely for any provider that hasn't opted in — Anthropic's
API rejects a `role: 'system'` entry inside `messages`, so this isn't
optional plumbing, it's what keeps those providers' turns working
unchanged. `allowToolWrites` threads through `chat()`, both API clients,
`src/App.tsx` (a checkbox next to the existing cloud-approval one), and
`bin/jarvis.mjs` (`/approve-tools`, mirroring `/approve-cloud`).

**Phase B — skills become model-callable.** `buildCapabilityRegistry`
adds every enabled skill (`app.skills()`) to the same registry Phase A
built, alongside MCP and core tools, not as a separate mechanism. Each
skill's tool name is its slash command with the leading `/` stripped and
any non `[a-zA-Z0-9_-]` character replaced with `_` (provider tool-name
constraints are stricter than a slash command's characters); if that
name collides with an existing MCP or core tool name, the skill is
skipped rather than shadowing it — MCP and core tools take priority.
Execution calls the same `executeSkill()` the `/slash` path already
uses, so a skill behaves identically whichever entry point invoked it.
Skills are read-only-permission in the registry, per the Decision
section above — same trust level as typing the slash command directly.
No changes to `chat()`'s tool loop are needed: it already dispatches
generically off the registry, so adding skills to the registry is
sufficient. `anthropic` and `gemini` remain out of scope until they gain
`supportsToolCalling`.

Phase C: agent delegation becomes model-callable.

## Consequences

- Skill and MCP tool execution becomes reachable two ways — explicit
  command or autonomous call — against one registry instead of duplicated
  lookups per entry point.
- Existing approval gates (cloud, agent) extend to cover model-initiated
  tool calls rather than being bypassed by them.
- No local `llama.cpp`/Ollama endpoint is reachable from the environment
  implementing this — end-to-end verification against a live local model
  happens separately, outside this environment.
