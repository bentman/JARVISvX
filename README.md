# JARVISvX

JARVISvX is a local assistant with a loopback-only daemon, an Electron voice host, and a `jarvis` CLI. The daemon owns SQLite state, provider access, active turns, local voice-model bootstrap, and the event stream shared by both clients.

## Requirements

- Node.js 24.15 or newer
- A local LLM runtime: llama.cpp / llama.app or Ollama
- Windows microphone permission for the Electron host

## Desktop

```powershell
npm install
npm run build
npm run desktop
```

The Electron host runs the local voice lifecycle: wake listening, capture, Whisper transcription, model streaming, and Kokoro playback. Closing its window hides it in the tray; use **Quit** from the tray menu to stop the host.

The first-run voice bootstrap downloads the local wake-word, Whisper, and Kokoro model bundles. `bf_isabella` is the available default Kokoro voice.

## CLI

```powershell
npm link
jarvis
jarvis ask "summarize this project"
jarvis doctor
jarvis daemon
jarvis workspace add E:\WORK\CODE\REPO\JARVISvX
```

`jarvis` opens the interactive terminal client. It attaches to an existing daemon or starts the hidden Electron voice host when needed.

Interactive commands:

```text
/new /sessions /resume /provider /model /voice /listen /mute /interrupt
/doctor /workspace /settings /approve-cloud /help /exit
```

## Development and diagnostics

```powershell
npm run dev       # starts the singleton daemon
npm run build
npm test
jarvis doctor
```

`npm run dev` does not start Vite or a second application core. Build before starting the desktop host or daemon when `dist` does not exist.

## Storage

JARVIS keeps its artifacts in the repository directory:

- `models\wake`, `models\stt`, `models\tts`: durable, hash-verified voice model bundles
- `data\sql-db`: SQLite database and daemon discovery/lock while running
- `data\electron-profile`: durable Electron profile
- `cache`: re-creatable state; `cache\temp` is temporary download staging

It does not use `%APPDATA%` or a home-directory JARVIS data folder.

## Providers and safety

llama.cpp / llama.app and Ollama use local HTTP endpoints. The optional OpenAI-compatible cloud provider reads `JARVIS_CLOUD_URL`, `JARVIS_CLOUD_MODEL`, and `JARVIS_CLOUD_API_KEY` from the environment; each cloud turn requires explicit approval.

Workspace tools are read-only. They require an approved root, read UTF-8 text only, and limit reads to 1 MiB. JARVIS does not write workspace files, execute generated code, install skills, or retain raw microphone audio by default.
