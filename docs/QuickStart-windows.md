# QuickStart — Windows

Get JARVISvX installed, built, and running on Windows in a few minutes.

## Requirements

- **Node.js** ≥ 24.15
- **LLM runtime** — llama.cpp / llama.app (`http://127.0.0.1:8080`) or Ollama (`http://127.0.0.1:11434`), running before you start a chat
- **Microphone permission** for the Electron host (Windows will prompt on first voice capture)

## Install & Build

```powershell
npm install
npm update
npm run build
```

`npm run build` produces `dist/` — required before the desktop host will show a UI.

## Run

**Desktop (Electron voice host):**

```powershell
npm run desktop
```

First run downloads the wake-word, Whisper, and Kokoro model bundles into `models/`. Default voice: `bf_isabella`. Closing the window hides it to the tray; use **Quit** from the tray menu to exit fully.

**CLI:**

```powershell
npm link
jarvis
```

`jarvis` attaches to a running daemon, or starts one, automatically. See [OperatorsGuide-CLI.md](OperatorsGuide-CLI.md) for the full command reference.

> **`npm link` fails with `EEXIST ... AppData\Roaming\npm\jarvis`?** That's npm's own
> global command shim, not JARVIS data — it's written once per machine the first time
> you link, and re-cloning or deleting the repo doesn't clear it, so a second `npm link`
> (from this clone or any other) collides with the one already there. Fix once with:
> ```powershell
> npm uninstall -g jarvis
> npm link
> ```
> (or `npm link --force` to overwrite it directly).

## Configuration

Copy `.env.example` to `.env` and adjust — it documents every variable (ports,
provider URLs, data directory, cloud credentials) inline.

## Next Steps

- Using the desktop UI day-to-day → [OperatorsGuide-GUI.md](OperatorsGuide-GUI.md)
- Using the `jarvis` CLI day-to-day → [OperatorsGuide-CLI.md](OperatorsGuide-CLI.md)
- Architecture, storage layout, safety model → [README.md](../README.md)
