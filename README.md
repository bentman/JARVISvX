# JARVISvX

Local-first voice and terminal AI assistant. A loopback-only daemon owns SQLite state, provider routing, and an SSE event stream shared by two clients: an Electron voice host and a `jarvis` CLI.

## Requirements

- **Node.js** ≥ 24.15
- **LLM runtime** — llama.cpp / llama.app (`http://127.0.0.1:8080`) or Ollama (`http://127.0.0.1:11434`)
- **Windows** — microphone permission required for the Electron host

## Quick Start

```powershell
npm install
npm run build

# Desktop (Electron voice host)
npm run desktop

# CLI
npm link
jarvis
```

`jarvis` attaches to a running daemon or starts the Electron host if none is found.

## Usage

### Desktop

```powershell
npm run desktop
```

Runs the Electron voice host: wake-word listening → microphone capture → Whisper transcription → model streaming → Kokoro TTS playback. Closing the window hides to tray; use **Quit** from the tray menu to exit.

First run downloads wake-word, Whisper, and Kokoro model bundles into `models/`. Default voice: `bf_isabella`.

### CLI

```powershell
jarvis                                    # interactive REPL
jarvis ask "summarize this project"       # one-shot
jarvis doctor                             # check daemon, providers, models
jarvis daemon                             # start daemon in foreground
jarvis workspace add E:\WORK\CODE\REPO\JARVISvX
```

**Interactive commands:**

```
/new  /sessions  /resume  /provider  /model  /voice  /listen  /mute  /interrupt
/doctor  /workspace  /settings  /approve-cloud  /help  /exit
```

### Development

```powershell
npm run dev          # start daemon (server.mjs, port 3210)
npm run build        # vite build → dist/
npm test             # Node built-in test runner
npm run lint         # tsc --noEmit
```

`npm run dev` starts only the daemon — not Vite or a second process. Build before running the desktop host if `dist/` is absent.

## Configuration

Copy `.env.example` to `.env` and adjust as needed:

```env
JARVIS_PORT=3210
JARVIS_LLAMACPP_URL=http://127.0.0.1:8080/v1
JARVIS_OLLAMA_URL=http://127.0.0.1:11434

# Optional — requires explicit per-turn approval
JARVIS_CLOUD_URL=
JARVIS_CLOUD_MODEL=
JARVIS_CLOUD_API_KEY=
```

## Storage Layout

All artifacts are kept inside the repository directory.

| Path | Contents |
|---|---|
| `models/wake` | Wake-word ONNX bundle |
| `models/stt` | Whisper STT bundle |
| `models/tts` | Kokoro TTS bundle |
| `data/sql-db` | SQLite database; daemon lock/discovery file while running |
| `data/electron-profile` | Durable Electron user profile |
| `cache/` | Re-creatable runtime state (`cache/temp` = download staging) |

No data is written to `%APPDATA%` or a home-directory folder.

## Providers

| Provider | Transport | Notes |
|---|---|---|
| llama.cpp / llama.app | Local HTTP | Default; no approval required |
| Ollama | Local HTTP | Default; no approval required |
| OpenAI-compatible cloud | HTTPS | Requires explicit per-turn `/approve-cloud` |

## Architecture

```
jarvis CLI  ─┐
              ├─ SSE / HTTP ─── daemon (Express, port 3210)
Electron     ─┘                   │
host                           SQLite (sessions, memory, settings)
                                  │
                               providers.mjs (llama.cpp · Ollama · cloud)
                               mcp-skills.mjs (tool calls)
                               voice-runtime.mjs (wake · Whisper · Kokoro)
```

**lib/** modules: `application`, `daemon`, `database`, `diagnostics`, `event-hub`, `mcp-skills`, `memory-engine`, `model-bootstrap`, `orchestrator`, `providers`, `tools`, `voice-runtime`, `voice-transcript`, `api`.

## Safety

- Workspace tools are **read-only**: approved root required, UTF-8 text only, 1 MiB limit per read.
- JARVIS does not write workspace files, execute generated code, install skills, or retain raw microphone audio.
- Cloud turns require explicit in-session approval (`/approve-cloud`).

## License

MIT — see [LICENSE](LICENSE).
