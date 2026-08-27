# JARVISvX

Local-first voice and terminal AI assistant. A loopback-only daemon owns SQLite state, provider routing, and an SSE event stream shared by two clients: an Electron voice host and a `jarvis` CLI.

## Getting Started

- **Windows** → [docs/QuickStart-windows.md](docs/QuickStart-windows.md)
- **Linux** → [docs/QuickStart-linux.md](docs/QuickStart-linux.md)

Both cover requirements, install/build, and running the desktop host or CLI for the
first time.

## Guides

- **Desktop GUI, day-to-day operation** → [docs/OperatorsGuide-GUI.md](docs/OperatorsGuide-GUI.md)
- **`jarvis` CLI, day-to-day operation** → [docs/OperatorsGuide-CLI.md](docs/OperatorsGuide-CLI.md)

## Configuration

Copy `.env.example` to `.env` and adjust — it documents every variable (ports,
provider URLs, data directory, cloud credentials) inline.

## Storage Layout

All artifacts are kept inside the application directory. A packaged desktop
build resolves the same layout beside its executable; `JARVIS_DATA_DIR`,
`JARVIS_MODEL_DIR`, and `JARVIS_TEMP_DIR` relocate their roots.

Setting `JARVIS_DATA_DIR` **moves** the existing `data/` directory to the new
root on the next start — it is a relocation, not a copy, and it carries the
whole directory including files JARVIS did not write. Each root follows only its
own variable: relocating the data root leaves `models/` and `cache/` where they
are. The move is staged and validated before the source is retired, so an
interruption leaves one complete copy and re-running converges.

| Path | Contents | Follows |
|---|---|---|
| `models/wake` | Wake-word ONNX bundle | `JARVIS_MODEL_DIR` |
| `models/stt` | Whisper STT bundle | `JARVIS_MODEL_DIR` |
| `models/tts` | Kokoro TTS bundle | `JARVIS_MODEL_DIR` |
| `data/sql-db/jarvis.sqlite` | SQLite application database, joined by `jarvis.sqlite-wal` and `jarvis.sqlite-shm` while a connection is open | `JARVIS_DATA_DIR` |
| `data/daemon.lock` | Single-instance ownership lock while the daemon runs; records the owner's PID, instance id, and when it was taken | `JARVIS_DATA_DIR` |
| `data/daemon.json` | Loopback port, process identity, and client token discovery while the daemon runs | `JARVIS_DATA_DIR` |
| `data/provider.key` | Provider-credential key material, generated on first stored credential when `JARVIS_KEY_SALT` is empty; preserve it with the database | `JARVIS_DATA_DIR` |
| `data/agents.json` | Agent-profile overrides, written when a profile is saved | `JARVIS_DATA_DIR` |
| `data/electron-profile` | Durable Electron user profile | `JARVIS_DATA_DIR` |
| `cache/temp` | Download staging | `JARVIS_TEMP_DIR` |
| `cache/electron/session` | Re-creatable Chromium session state | `JARVIS_TEMP_DIR` |
| `cache/electron/logs` | Electron and daemon logs | `JARVIS_TEMP_DIR` |
| `cache/electron/crash-dumps` | Electron crash reports | `JARVIS_TEMP_DIR` |

The lock and discovery files exist only while the daemon is running; a clean
shutdown removes both. A contender releases an existing lock only on evidence
its owner is gone — the recorded process is absent **and** no instance answers
the ownership probe as that owner.

The database runs under write-ahead logging, so its `-wal` and `-shm` siblings
accompany it while a connection is open and a clean close checkpoints and removes
them. The three files are one unit: anything that moves, copies, or backs up the
database takes all three. Write-ahead logging needs shared memory between
processes, which a network file system cannot provide — a `JARVIS_DATA_DIR` on a
share is refused at startup rather than run with reduced durability.

No data is written to `%APPDATA%` or a home-directory folder — this holds regardless of
the working directory `jarvis` is launched from, since defaults are anchored to the
install directory, not the current shell's cwd. (The one unrelated exception is npm's
own global `jarvis` command shim under `%APPDATA%\npm`, created by `npm link` itself —
see the `npm link` troubleshooting note in [docs/QuickStart-windows.md](docs/QuickStart-windows.md).)

## Providers

| Provider | Transport | Notes |
|---|---|---|
| llama.cpp / llama.app | Local HTTP | Default; no approval required |
| Ollama | Local HTTP | Default; no approval required |
| OpenAI-compatible cloud | HTTPS | Requires explicit per-turn `/approve-cloud` |

## Architecture

```mermaid
flowchart TB
  subgraph Clients
    CLI["jarvis CLI<br/>Ink TUI · bin/jarvis.mjs"]
    Renderer["Electron renderer<br/>built React UI (dist/)"]
  end

  subgraph Electron["Electron main process"]
    Main["main.mjs"]
    TTS["Kokoro TTS<br/>worker_thread"]
  end

  subgraph Daemon["daemon.mjs — Express, loopback :3210, token-gated"]
    API["api.mjs<br/>REST + SSE router<br/>(event-hub.mjs pub/sub)"]
  end

  subgraph App["application.mjs — core turn loop"]
    Chat["chat()"]
    Reason["reasoning-stream.mjs"]
    Orch["orchestrator.mjs<br/>tag-based routing"]
    Agents["agents/<br/>registry · coordinator · policy"]
    Skills["mcp-skills.mjs<br/>tools & slash skills"]
    Voice["voice-runtime.mjs"]
    Memory["memory-engine.mjs"]
  end

  subgraph Providers["providers/ — registry, tag-routed"]
    Reg["ProviderRegistry"]
    Adapters["openai-compat · ollama<br/>anthropic · gemini · azure-openai"]
  end

  subgraph Storage
    DB[("SQLite<br/>database.mjs")]
    Models["models/<br/>wake · stt · tts bundles"]
  end

  CLI -- "spawns if absent" --> Daemon
  Main -- "starts in-process<br/>or reconnects" --> Daemon
  Main --> Renderer
  Renderer -- "IPC: tts · voice · daemon" --> Main
  Main --> TTS

  CLI -- "HTTP + SSE /api/*" --> API
  Renderer -- "HTTP + SSE /api/*" --> API

  API --> Chat
  API --> Agents
  API --> Voice
  API --> Skills
  API --> Memory

  Chat --> Reason
  Chat --> Orch
  Chat --> Skills
  Chat -- "SSE events" --> API

  Orch --> Reg
  Reg --> Adapters
  Reg --> DB
  Chat --> DB
  Voice --> Models
```

The daemon is the only process that touches SQLite or the provider
registry; both clients — the CLI and the Electron renderer — reach it
exclusively over loopback HTTP/SSE, authenticated by a per-process token
(`x-jarvis-token`). Electron's main process is a special case: it can start
the daemon in-process instead of over HTTP, and separately runs a Kokoro
TTS worker thread that the renderer drives directly over IPC (not through
the daemon).

**lib/** modules: `api`, `application`, `authorization`, `capabilities`, `contracts`, `daemon`, `daemon-client`, `data-migration`, `database`, `diagnostics`, `event-hub`, `mcp-skills`, `mcp-stdio`, `memory-engine`, `model-bootstrap`, `orchestrator`, `providers/` (provider registry, tag-based routing), `reasoning-stream`, `runtime-paths`, `skills-source`, `tools`, `voice-runtime`, `voice-transcript`, plus `agents/` (registry, coordinator, policy, adapters).

The daemon reports a lifecycle state — `starting`, `ready`, `degraded`, or
`stopping` — through `/api/health` and the authenticated `/daemon/status` probe.
Core services gate readiness; voice-model acquisition does not, so a cold start
serves text while it reports `degraded` with the subsystem and its recovery
named. Turns are refused with `not_ready` only while `starting`.

Voice model artifacts are pinned to immutable revisions and verified by declared
size and sha256 before use, so a truncated or substituted file is replaced rather
than trusted.

## Safety

- Workspace tools are **read-only**: approved root required, UTF-8 text only, 1 MiB limit per read.
- Workspace file writes always go through a proposal/approval queue — JARVIS never writes a file without an explicit per-edit operator approval.
- JARVIS does not auto-execute LLM-generated code or retain raw microphone audio. Operators can add custom skills (authored directly or imported from `skills.sh`), and that code runs only when explicitly invoked.
- Cloud turns require explicit in-session approval (`/approve-cloud`).

## Contributing

Conventions for documentation, testing scope, git, commands, and completion
reporting live in [AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).
