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
- Tools that write or execute (`write_workspace_file`,
  `propose_workspace_edit`, mutating MCP tools) surface an
  approval-required event, the same shape the workspace-edit
  propose/approve flow already uses.
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

Phase A: workspace and MCP tools, `openai-compat` and `ollama` first
(the protocols behind local, `llama.app`-hosted models), `anthropic` and
`gemini` after. Phase B: skills become model-callable in addition to
slash-matched. Phase C: agent delegation becomes model-callable.

## Consequences

- Skill and MCP tool execution becomes reachable two ways — explicit
  command or autonomous call — against one registry instead of duplicated
  lookups per entry point.
- Existing approval gates (cloud, agent) extend to cover model-initiated
  tool calls rather than being bypassed by them.
- No local `llama.cpp`/Ollama endpoint is reachable from the environment
  implementing this — end-to-end verification against a live local model
  happens separately, outside this environment.
