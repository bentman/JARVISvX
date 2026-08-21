# ADR 0002: Centralize model-callable capabilities

Status: Accepted
Date: 2026-08-19

## Context

A model-callable operation requires a unique name, provider-compatible parameter
schema, permission classification, and executor. MCP tools, application tools,
enabled skills, and agent delegation all participate in this namespace.

Provider protocols also differ in their ability to serialize tool declarations,
parse tool calls, and represent tool results. Capability exposure therefore
depends on an explicit provider transport contract.

## Decision

`lib/capabilities.mjs` owns the model-callable capability registry. It creates one
turn-scoped registry in this order:

1. declared tools from registered MCP servers;
2. application tools with registered core schemas and executors;
3. enabled skills; and
4. `agents_list` and `agents_ask` when agent profiles are available.

The first registration owns a capability name. Later entries with the same name
are omitted, giving every exposed name one schema, permission, and execution path.
Skill names derive from their slash commands and are normalized to the provider
tool-name character set.

Each capability has either `read-only` or `approval-required` permission.
MCP tools are approval-required when their declaration marks them mutating or
their name begins with `write`, `delete`, or `create`. Enabled skills and
`agents_list` are read-only. `agents_ask` is approval-required.
`propose_workspace_edit` is read-only at invocation because it creates a
`pending_review` record; the workspace-edit approval operation owns the
filesystem write.

`BaseProvider.supportsToolCalling` is false by default. A provider adapter sets it
to true only when its `streamChat()` implementation accepts tool schemas and emits
canonical `tool_call` pieces. `OpenAICompatProvider` and `OllamaProvider` implement
this contract. `lib/application.mjs` gives other providers unmodified conversation
history without a capability prompt or tool payload.

For a tool-calling provider, `application.chat()` supplies the registry schemas
and a human-readable capability summary in request-local provider messages. It
executes at most four tool-call batches in one turn. Read-only capabilities run
immediately. An approval-required capability runs only when the turn carries
`allowToolWrites`; otherwise the application emits `tool-approval-required` and
ends the turn. The approved `agents_ask` executor forwards the turn's `allowCloud`
value and satisfies the selected agent profile's privileged-capability gate.

Tool calls and results are published as `tool-call` and `tool-result` events and
are returned to the provider for the next tool round. Capability metadata, tool
activity, and provider-facing tool messages remain request-local. Conversation
persistence stores the user message and final assistant output.

## Consequences

- Model-initiated MCP, application, skill, and agent operations share one bounded
  dispatch loop and one collision policy.
- Registry composition is a snapshot for the turn; configuration changes affect
  the next turn.
- MCP registration order determines ownership of collisions before core tools,
  skills, and agent capabilities are considered.
- `allowToolWrites` authorizes every model-callable capability classified as
  approval-required, including `agents_ask`.
- Slash-command skill execution and explicit agent-run entry points retain their
  own routing and authorization controls; this ADR governs model-initiated
  capability calls through `application.chat()`.
- A provider participates only after its adapter implements and declares the
  tool-calling transport contract.
