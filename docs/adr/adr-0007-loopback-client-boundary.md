# ADR 0007: The loopback client boundary and token delivery

Status: Implemented
Date: 2026-08-25

## Context

The daemon binds to loopback and authenticates HTTP and SSE requests with a
per-run token. The desktop host delivered that token by putting it in the page's
navigation URL, which the renderer then parsed back out of
`window.location.search`.

A URL is the most quotable thing in a browser. It reaches the page title, the
session history, referrer headers, crash reports, and any log that records what
was loaded — none of which need the token, and all of which outlive the run.
Electron already had a narrower channel: the `jarvis:daemon` IPC handler exposed
through `electron/preload.cjs`, which hands the token to the renderer without it
ever appearing in navigable state.

## Decision

**Preload token delivery.** Electron navigates to the daemon origin without
query parameters and delivers the session token via the IPC preload bridge
(`electron/preload.cjs`). The renderer consumes token state directly from this
bridge.

**Each client uses the channel it already has.** Electron uses the IPC bridge.
The CLI uses the discovery file the daemon writes into its data root.
`GET /api/session` remains the bootstrap for a browser-hosted UI only.

**The bootstrap is bound to its own origin.** `/api/session` answers only a
loopback connection whose `Host` and `Origin` name this daemon, and sets
`Cache-Control: no-store`. A page from another origin cannot read it.

**Token scope and isolation.** The token authenticates HTTP and SSE requests to
the loopback daemon, isolating daemon access from foreign browser origins.
Sensitive token values are excluded from logs, error messages, navigation
history, and diagnostic payloads.

## Consequences

- Tokens remain isolated from navigation history, referrers, and crash reports.
- Each client uses a single designated channel: IPC for Electron desktop, the
  discovery file for CLI, and authenticated `/api/session` for loopback browser
  sessions.
- Process-level isolation among local user processes remains the responsibility
  of operating system user permissions.
