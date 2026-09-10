# ADR 0006: MCP discovery records a server's contract without trusting it

Status: Implemented
Date: 2026-08-25

## Context

An MCP server describes its own tools: names, descriptions, a JSON Schema for
each tool's input, and optional annotations such as `readOnlyHint`. Two
questions follow from that, and they have different answers.

The first is fidelity. Tool parameters require expressive schemas: enums,
arrays, nested objects, and distinct numeric and boolean types must reach the
model intact without lossy string flattening.

The second is trust. `readOnlyHint` is a claim made by the same party that would
benefit from being trusted. A tool marked read-only skips the approval gate, so
honoring that claim from an arbitrary server would let the server decide its own
permissions.

Health reporting requires empirical accuracy: server status and latency must
reflect actual probe observations rather than synthetic placeholders.

## Decision

**Discovery stores what the server said.** `listStdioTools` records the tool's
`inputSchema`, `description`, and `annotations` verbatim as the server's
callable contract. HTTP and stdio discovery reach the same representation.

**Conversion is lossless within the supported set.** `lib/capabilities.mjs`
converts a stored schema to the provider tool schema, preserving object, array,
string, number, integer, boolean, enum, `required`, and nested properties. A
keyword or type it cannot convert is listed on the capability record's
`unsupportedSchema`, so the gap is visible instead of silent.

**Application-owned permission classification.** A tool is `read-only`
exclusively when an application-owned declaration classifies it as such
(consistent with ADR 0003). Server annotations are persisted and displayed for
inspection, while execution policy mandates approval for all unverified tools.

**Health is an observation or it is nothing.** `mcp_servers` carries `status`
(`unknown`, `connected`, `error`), a nullable `latency_ms`, `last_probe_at`, and
`failure_reason`. Registration writes `unknown` with every observation field
null. Only a completed probe writes health: success records measured latency and
clears the failure reason; failure records the elapsed time and a bounded
reason. A probe is a real exchange for its transport — `initialize` for stdio, a
JSON-RPC round trip for HTTP, and the owning runtime's own check for the
built-in workspace and SQLite servers. Stored server records without a recorded
probe timestamp initialize with `unknown` status.

**The HTTP transport is held to the stdio transport's standard.** Calls carry a
JSON-RPC request id, a bounded timeout with cancellation, HTTP-status and
content-type validation, and JSON-RPC error handling. An RPC error is a failed
capability result, not a success carrying an error payload.

## Consequences

- A model sees a discovered tool's real parameter schema, including enums and
  nested shapes, rather than a flattened approximation.
- A schema feature this conversion cannot express is reported rather than
  dropped, so the limitation is discoverable instead of mysterious.
- Tool authorization boundaries remain under application control regardless of
  server-provided hints.
- A displayed MCP latency or status was measured; when nothing has been
  measured, the UI says `unknown` rather than inventing a number.
- A misbehaving HTTP server produces a failed result with a reason instead of a
  successful-looking result containing its error.
