# QuickStart — Linux

Get JARVISvX installed, built, and running on Linux in a few minutes.

## Requirements

- **Node.js** ≥ 24.15
- **LLM runtime** — llama.cpp / llama.app (`http://127.0.0.1:8080`) or Ollama (`http://127.0.0.1:11434`), running before you start a chat
- **Microphone access** for the Electron host — grant it through your desktop environment's privacy/sound settings when prompted; requirements vary by distro (PulseAudio/PipeWire permissions, sandbox exceptions, etc.)

## Install & Build

```bash
npm install
npm update
npm run build
```

`npm run build` produces `dist/` — required before the desktop host will show a UI.

If `npm install` fails to build a native dependency (`sharp`, `onnxruntime-node`), re-run with optional platform packages included:

```bash
npm install --include=optional
```

## Run

**Desktop (Electron voice host):**

```bash
npm run desktop
```

First run downloads the wake-word, Whisper, and Kokoro model bundles into `models/`. Default voice: `bf_isabella`. Closing the window hides it to the tray; use **Quit** from the tray menu to exit fully.

**CLI:**

Direct in-repo execution:
```bash
npm run cli
# or with arguments:
npm run cli -- ask "Hello"
```

Or load the session helper into your current shell session (no global npm symlinks):
```bash
source scripts/use-jarvis.sh
jarvis
```

For a permanent standalone command across any directory without touching `npm link`, run `./scripts/install-cli.sh`.

`jarvis` attaches to a running daemon, or starts one, automatically. See [OperatorsGuide-CLI.md](OperatorsGuide-CLI.md) for the full command reference.

> **Legacy `npm link` cleanup:** If you previously ran `npm link`, remove npm's global symlink to prevent npm errors:
> ```bash
> npm uninstall -g jarvis jarvisvx
> ```

## Configuration

Copy `.env.example` to `.env` and adjust — it documents every variable (ports,
provider URLs, data directory, cloud credentials) inline.

### Moving the data directory

`JARVIS_DATA_DIR` points JARVIS at a different data directory. When data already
exists in the current one, the move is authorized once rather than happening as a
side effect of whatever command ran next. The desktop host asks; every other
start refuses and names both paths.

Set the new location in `.env`, then authorize the single run that moves it:

```bash
JARVIS_DATA_MIGRATE=1 npm run dev
```

Later starts need nothing: the data is already at the new location, so there is
no move left to authorize.

## Next Steps

- Using the desktop UI day-to-day → [OperatorsGuide-GUI.md](OperatorsGuide-GUI.md)
- Using the `jarvis` CLI day-to-day → [OperatorsGuide-CLI.md](OperatorsGuide-CLI.md)
- Architecture, storage layout, safety model → [README.md](../README.md)
