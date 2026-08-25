# ADR 0006: MCP discovery records a server's contract without trusting it

Status: Accepted
Date: 2026-08-25

## Context

An MCP server describes its own tools: names, descriptions, a JSON Schema for
each tool's input, and optional annotations such as `readOnlyHint`. Two
questions follow from that, and they have different answers.

The first is fidelity. Discovery previously flattened each `inputSchema` into a
`"name?: type"` string, so enums, arrays, nested objects, and the
integer/number/boolean distinction were lost before a model ever saw the tool.
Nothing reported the loss.

The second is trust. `readOnlyHint` is a claim made by the same party that would
benefit from being trusted. A tool marked read-only skips the approval gate, so
honoring that claim from an arbitrary server would let the server decide its own
permissions.

Health had the same shape of problem: registering a server wrote `connected`
with a random latency, so the UI displayed a measurement that had never been
taken.

## Decision

**Discovery stores what the server said.** `listStdioTools` records the tool's
`inputSchema`, `description`, and `annotations` verbatim as the server's
callable contract. HTTP and stdio discovery reach the same representation.

**Conversion is lossless within the supported set.** `lib/capabilities.mjs`
converts a stored schema to the provider tool schema, preserving object, array,
string, number, integer, boolean, enum, `required`, and nested properties. A
keyword or type it cannot convert is listed on the capability record's
`unsupportedSchema`, so the gap is visible instead of silent.

**Annotations do not grant permission.** The rule from ADR 0003 stands
unchanged: a tool is `read-only` only when an application-owned declaration says
so. A server's own annotations are recorded and shown but never widen its
permission, so an unannotated *and* a self-declared-safe operation both require
approval. Granting a server that trust would need a deliberate operator action,
which this decision does not create.

**Health is an observation or it is nothing.** `mcp_servers` carries `status`
(`unknown`, `connected`, `error`), a nullable `latency_ms`, `last_probe_at`, and
`failure_reason`. Registration writes `unknown` with every observation field
null. Only a completed probe writes health: success records measured latency and
clears the failure reason; failure records the elapsed time and a bounded
reason. A probe is a real exchange for its transport — `initialize` for stdio, a
JSON-RPC round trip for HTTP, and the owning runtime's own check for the
built-in workspace and SQLite servers. Rows migrated from the previous schema
have no probe time and therefore become `unknown`.

**The HTTP transport is held to the stdio transport's standard.** Calls carry a
JSON-RPC request id, a bounded timeout with cancellation, HTTP-status and
content-type validation, and JSON-RPC error handling. An RPC error is a failed
capability result, not a success carrying an error payload.

## Consequences

- A model sees a discovered tool's real parameter schema, including enums and
  nested shapes, rather than a flattened approximation.
- A schema feature this conversion cannot express is reported rather than
  dropped, so the limitation is discoverable instead of mysterious.
- No third-party server can mark its own tool safe enough to skip approval.
- A displayed MCP latency or status was measured; when nothing has been
  measured, the UI says `unknown` rather than inventing a number.
- A misbehaving HTTP server produces a failed result with a reason instead of a
  successful-looking result containing its error.
