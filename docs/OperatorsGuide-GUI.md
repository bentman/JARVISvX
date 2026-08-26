# Operators Guide — Desktop GUI

Day-to-day operation of the JARVISvX Electron desktop app. For installation, see
[QuickStart-windows.md](QuickStart-windows.md) or [QuickStart-linux.md](QuickStart-linux.md).

## Introduction

The desktop app is a voice-first assistant surface built on top of the same local
daemon and API the `jarvis` CLI uses (see [README.md](../README.md#architecture)) — nothing
in this UI does anything the daemon itself doesn't already expose over `/api/*`.

The main window is a chat surface: a conversation sidebar on the left, the active
conversation and composer in the center, and a status header showing the active
provider, model, and cloud-approval state. A row of buttons at the bottom of the
sidebar opens **side panels** — Voice HUD, Agent Runtime, Providers, MCP & Skills,
Orchestration, Memory Center, Workspaces, Diagnostics, and Settings — each a focused
operator surface for one part of the system. Only one side panel is open at a time;
close it with the **×** in its top corner to return to the chat view.

Operational intent: give a human operator full visibility into, and control over,
every subsystem — voice, providers, models, agents, MCP servers, skills, memory,
workspace file-write safety, and live diagnostics — without ever needing to touch the
SQLite database or config files directly.

## Operations

- **Chat & Composer** — send a message, `/slash` skill, or `@agent` command; cancel an
  in-flight turn; push-to-talk; approve cloud requests or tool writes for the next
  turn only.
- **Voice HUD** — switch between wake-word and push-to-talk listening modes, pick a
  Kokoro TTS voice persona, watch a live speech/state log, interrupt playback.
- **Agent Runtime** — view the seven built-in agent roles and any custom agents; add,
  edit, or delete custom agents; dispatch solo, panel, or debate runs.
- **Providers** — add, edit, delete, enable/disable, test, and re-prioritize LLM
  provider connections (local and cloud).
- **MCP & Skills** — register/remove MCP servers and probe their tools; manage
  built-in and custom skills, including import from `skills.sh`-format repos and
  export to a `SKILL.md` file.
- **Orchestration** — choose the execution policy (Auto, Local Only, Cloud Only, or
  pinned to one provider), configure the local model endpoint, and tune
  auto-escalation thresholds.
- **Memory Center** — browse, search, add, edit, and delete stored memory facts by
  category; trigger auto-summarization of recent conversation history.
- **Workspaces** — approve or remove workspace root folders; review, approve, or
  reject file edits JARVIS proposes mid-conversation.
- **Diagnostics** — inspect live hardware, GPU/NPU acceleration, provider
  reachability, and voice pipeline status.
- **Settings** — quick-switch the active provider and model; toggle the cloud-request
  approval guardrail.

## Components

### Chat & Composer

The center pane is the primary surface. Type a message and press **Enter** to send
(**Alt+Enter** inserts a newline instead). Use `/searchterm` to invoke a slash skill,
or `@agentid your objective` to run a single agent directly in the conversation.
While a turn is streaming, the stop icon next to the composer cancels it. If the
active provider is cloud-tagged, a **cloud approval** checkbox appears above the
composer and must be checked before sending — it only covers the next message. A
second checkbox, **Allow JARVIS to run tools that write files or execute changes**,
gates any tool call that would modify the workspace or run a command; leave it
unchecked to stay read-only. The header's Provider and Model badges are clickable
shortcuts into Settings.

### Voice HUD

Open with the microphone icon in the sidebar footer. The orb in the center reflects
the current voice state (listening, capturing, thinking, speaking); click it to
push-to-talk. **Mode** toggles between wake-word (`"Hey Jarvis"`) and push-to-talk
listening. Pick a TTS persona from the voice list on the left — the change applies
immediately. The right-hand **Speech Log** streams every voice-state transition and
final transcript live; it's a real-time view of the local voice pipeline, not a
static log. **Interrupt Speech** stops playback immediately.

### Agent Runtime

Open with the Users icon. Each agent card shows its adapter/CLI, capabilities, voice,
and instructions. The seven built-in roles (Architect, Reviewer, Builder, Security,
Debugger, Researcher, Adversary) allow editing adapter, CLI, voice, and capabilities,
but not name or instructions. Click **Add Agent** to create a custom agent — name (24
characters max), description, instructions (255 characters max), adapter (`acp` or
`process`), CLI (for `acp` agents: `claude`, `codex`, `copilot`, `cline`, or `agy`),
voice persona, and capabilities (`workspace.read`, `workspace.write`, `git.read`,
`shell` — the latter two require per-run approval). Delete is available only for
custom agents. To run an agent, use `@agentid objective` in chat, or `/panel`/`/debate`
for multi-agent runs (see [OperatorsGuide-CLI.md](OperatorsGuide-CLI.md) for the CLI
equivalents).

The panel's **Execute Run** form takes a mode and an objective. In `solo` mode you
pick one agent. In `panel` and `debate` you tick **Participants**; leaving the
selection empty runs the daemon's default roster for that mode — Architect,
Reviewer, and Security for a panel; Architect, Reviewer, and Adversary for a
debate — and the form names the roster it will use. Panel and debate both end
with a synthesis by the first participant, which receives every other
participant's labelled result. The approval checkbox appears whenever any agent
that will actually run holds a privileged capability.

### Providers

Open with the Database icon. **New Provider** lets you pick a protocol
(OpenAI-compatible, Ollama, Azure OpenAI, Anthropic, or Gemini) — the base URL and
default tags pre-fill from the protocol, and can be overridden. Set a **Priority**
(lower number = tried first); local providers default to a lower priority number than
cloud ones. Each configured provider card supports **Test** (probes the endpoint and
reports latency/reachability), **Toggle** (enable/disable without deleting), **Edit**,
and **Delete**. The currently active provider — the lowest-priority enabled one — is
marked; this is the same value every other panel (Settings, Orchestration) reads.

### MCP & Skills

Open with the Zap icon. The **MCP Servers** section lists registered servers with
their transport type and last-known status; add a server by name, endpoint, and
transport (HTTP JSON-RPC or stdio — SSE is not yet implemented), or remove one. The
**Skills** section lists built-in and custom skills with an enabled/disabled toggle.
**Import from skills.sh** fetches a real `SKILL.md` from a public GitHub repo (enter
it as `owner/repo` or `owner/repo/path/to/skill`) and installs it as a runnable
custom skill. **Export** downloads any skill as a `SKILL.md`-formatted file.

### Orchestration

Open with the Cpu icon. Three policy cards set the execution mode: **Auto**
(recommended — runs locally, escalates to cloud only when a configured threshold or
keyword rule matches and cloud is approved), **Local Only** (never calls a cloud
provider, full stop), and **Cloud Only** (always routes to a cloud provider,
requiring approval each turn — if more than one cloud provider is configured, pick
which one to pin). Below that, select which local endpoint (Ollama/llama.cpp
provider) to target, ping it to discover available model weights, and pick the
active local model. The **Cloud Escalation Threshold Rules** section tunes the
character-count threshold and whether web-search or code-execution requests trigger
an automatic escalation in Auto mode.

### Memory Center

Open with the Brain icon. Filter by category tab (User Preferences, System Facts,
Conversation Facts, Code Context) or search by key/value. **Add Memory** creates a
fact with a category, key, value, and importance level (high/medium/low). Click any
card to edit or delete it. **Auto-Summarize** extracts new facts from recent
conversation history using the same regex-based extraction the assistant uses
automatically during chat.

### Workspaces

Open with the FolderPlus icon. Add an absolute folder path to approve it for
JARVIS's read-only workspace tools (UTF-8 text only, 1 MiB cap per file) — remove a
root to revoke access. The **Future-Safe Boundary** section is the human checkpoint
for file edits: any conversation with tool-calling can propose an edit mid-turn via
the `propose_workspace_edit` tool, which only ever stages a row here — it never
touches disk until you **Approve & Write File** or **Reject** it. A **Propose Test
Workspace Code Edit** button exists to manually exercise this review flow. Past
decisions remain visible in the Audit History below.

### Diagnostics

Open with the Activity icon. Read-only telemetry: host class, OS, CPU, core count,
memory; GPU/NPU acceleration availability; per-provider reachability and protocol;
and voice pipeline diagnostics. **Refresh Telemetry** re-polls everything — nothing
here is cached beyond the current panel session.

### Settings

Open with the Settings icon (also reachable by clicking the Provider or Model badge
in the header). Quick-switch the **Active Provider Engine** and **Active Model
Selection** without opening the full Providers/Orchestration panels, and toggle the
**Cloud Request Approval Guardrail** checkbox that gates cloud-tagged provider turns.
