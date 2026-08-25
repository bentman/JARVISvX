# ADR 0007: The loopback client boundary and token delivery

Status: Accepted
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

**The token is not a URL parameter.** Electron navigates to the daemon origin
with no query string and delivers the token through the existing constrained
preload bridge. The renderer no longer reads token state from the URL.

**Each client uses the channel it already has.** Electron uses the IPC bridge.
The CLI uses the discovery file the daemon writes into its data root.
`GET /api/session` remains the bootstrap for a browser-hosted UI only.

**The bootstrap is bound to its own origin.** `/api/session` answers only a
loopback connection whose `Host` and `Origin` name this daemon, and sets
`Cache-Control: no-store`. A page from another origin cannot read it.

**The token is scoped honestly.** It authenticates HTTP and SSE requests to the
daemon. It is not an operating-system boundary: a local process running as the
same user can read the discovery file, and the token does not pretend otherwise.
What it does provide is that a random web page the user visits cannot drive the
daemon. The token stays out of logs, error messages, and diagnostic payloads.

## Consequences

- The token no longer appears in navigation history, referrers, or crash
  reports.
- Each client keeps one delivery mechanism, so there is no second path to audit.
- A browser-hosted UI still works, but only when served by the daemon itself.
- Protection against other local processes running as the same user is not
  claimed and would need a different mechanism.
