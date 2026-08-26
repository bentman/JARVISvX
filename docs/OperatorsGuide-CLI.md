# Operators Guide — CLI

Day-to-day operation of the `jarvis` command-line interface. For installation, see
[QuickStart-windows.md](QuickStart-windows.md) or [QuickStart-linux.md](QuickStart-linux.md).

## Introduction

`jarvis` is the terminal surface for JARVISvX — an interactive TUI for exploratory
sessions, plus a set of scriptable one-shot subcommands for automation and CI, all
talking to the same local daemon and API the desktop GUI uses (see
[README.md](../README.md#architecture)). Running `jarvis` with no arguments attaches
to a running daemon, or starts one, then opens the interactive TUI if stdout is a
terminal; every other subcommand runs once and exits with a real exit code, so it
composes with shell scripts and pipes.

Operational intent: everything an operator can do in the desktop GUI — dispatch
agents, manage MCP servers and skills, read and change settings — is also reachable
as a single command, without requiring a GUI session or a human watching a screen.

## Operations

- **Interactive TUI** (`jarvis`) — chat loop with `/slash` commands and `@agent`
  dispatch; the richest surface, meant for a human at a terminal.
- **`jarvis ask`** — one-shot scriptable prompt with provider/model selection, JSON
  event output, cloud/tool-write approval flags, and session resume.
- **`jarvis agent`** — list agent profiles, or run a solo/panel/debate agent
  dispatch from a script.
- **`jarvis mcp`** — list, add, remove, and ping MCP servers.
- **`jarvis skills`** — list, import (from `skills.sh`), export, toggle, and remove
  skills.
- **`jarvis settings`** — read the consolidated effective settings, or change the
  orchestration mode.
- **`jarvis workspace`** — list, add, and remove approved workspace roots.
- **`jarvis doctor` / `daemon` / `serve`** — diagnostics and daemon status.
- **`jarvis version` / `help`** — CLI version and full command reference; never
  require a running daemon.

## Components

### Interactive TUI

Running `jarvis` with no arguments (and a TTY attached) opens the interactive
session. Type a message and press Enter to send it to the active provider/model
shown in the header. Two input forms are recognized directly:

```
@architect design the plugin loader
/panel architect reviewer -- should we adopt this dependency?
```

`@<agent>` runs one agent inline; `/panel`/`/debate` run a multi-agent dispatch with
synthesized or debated output. Full slash-command reference is available inside the
session via `/help`; it covers session management (`/new`, `/sessions`, `/resume
<id>`), provider/model (`/provider <id>`, `/model [id]`), voice (`/voice [id]`,
`/listen`, `/mute`), approvals (`/approve-cloud`, `/approve-agent`,
`/approve-tools`), and workspace/settings/doctor.

If stdout is not a TTY (e.g. piped or redirected) and no subcommand is given, `jarvis`
prints a short notice and exits — use `jarvis ask` for non-interactive invocations.

### `jarvis ask`

```bash
jarvis ask "summarize this project"
jarvis ask --provider ollama --model llama3.2 "explain routeTurn()"
jarvis ask --json --allow-cloud "search for recent CVEs in this dependency"
echo "review this diff" | jarvis ask --allow-tools
jarvis ask --continue "and what about the tests?"
jarvis ask --resume <conversation-id> "one more thing"
```

Reads the message from the command line, or from stdin if none is given and stdin
isn't a terminal. Flags: `--provider <id>` and `--model <name>` override the default
selection for this turn only; `--json` prints each raw stream event as one JSON
object per line instead of plain text; `--allow-cloud` and `--allow-tools` approve
cloud escalation and file-writing tool calls for this turn only, matching the TUI's
`/approve-cloud` and `/approve-tools`; `--continue` resumes the most recent
conversation, `--resume <id>` resumes a specific one — omit both to start a fresh
conversation each call.

### `jarvis agent`

```bash
jarvis agent list
jarvis agents                                  # shorthand for `agent list`
jarvis agent run architect "design the plugin loader" --allow-cloud --approve
jarvis agent panel architect reviewer -- "should we adopt this dependency?"
jarvis agent debate builder adversary -- "is this migration safe?"
```

`list` prints every agent profile (id, name, adapter/CLI, voice, built-in vs.
custom). `run <agentId> "<objective>"` dispatches one agent solo; `panel` and
`debate` take two or more agent ids, a `--` separator, then the objective. All three
accept `--allow-cloud` (cloud approval for this run), `--approve` (privileged
capability approval — `workspace.write`/`shell`), `--conversation <id>` (attach the
run to an existing conversation), and `--json` (print the full run result as JSON
instead of just its text output).

### `jarvis mcp`

```bash
jarvis mcp list
jarvis mcp add "My HTTP Server" https://example.com/mcp --type http
jarvis mcp ping mcp-fs
jarvis mcp remove <id>
```

`list` shows every registered server with type, status, and endpoint. `add` accepts
`--type http` (default) or `--type stdio`. `ping` checks reachability without
modifying anything. `remove` deletes a server by id.

### `jarvis skills`

```bash
jarvis skills list
jarvis skills import vercel-labs/agent-skills/skills/web-design-guidelines
jarvis skills export my-skill-id --out ./my-skill.SKILL.md
jarvis skills toggle my-skill-id
jarvis skills remove my-skill-id
```

`list` shows every skill's slash command, name, enabled state, and type (built-in vs.
custom). `import <owner/repo[/path]>` fetches a real `SKILL.md` from GitHub and
installs it as a runnable skill. `export <id>` writes a `SKILL.md`-formatted file —
to `--out <path>` if given, otherwise to the current directory (or stdout, if not
attached to a terminal). `toggle` enables/disables a skill without deleting it;
`remove` deletes it.

### `jarvis settings`

```bash
jarvis settings                                # same as `settings get`
jarvis settings mode local_only
jarvis settings mode provider:<provider-id>
```

`get` (the default with no argument) prints the consolidated effective settings —
active provider/model, cloud configuration, orchestration mode, and auto-escalation
rules — as JSON. `mode <value>` changes the orchestration policy: `auto`,
`local_only`, `cloud_only`, or `provider:<id>` to pin routing to one specific
provider, mirroring the Orchestration panel in the GUI.

### `jarvis workspace`

```bash
jarvis workspace list
jarvis workspace add /home/user/projects/my-repo
jarvis workspace remove <id>
```

Manages the same approved workspace roots the Workspaces panel shows — required
before any workspace-reading tool call can succeed.

### Diagnostics & utility

```bash
jarvis doctor       # full diagnostics report (JSON)
jarvis daemon        # daemon health check (JSON)
jarvis serve         # print the running daemon's base URL
jarvis version       # CLI version
jarvis help          # full command reference
```

`version` and `help` never connect to a daemon — they answer immediately even if
none is running.

### Exit status

Every command reports its result to the shell, so `jarvis` composes with scripts
and CI. A command exits non-zero when its turn ends in an error or cancellation,
when a provider is unavailable, when an approval is denied, when an identifier is
unknown, or when an agent run fails. Reads and successful operations — `doctor`,
`daemon`, `settings get`, and the various `list` commands — exit zero. Plain and
`--json` output report the same result.
