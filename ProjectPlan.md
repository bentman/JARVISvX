# JARVISvX Voice-First Desktop and Connected CLI

## Summary

Build JARVIS as one persistent local assistant daemon with two interchangeable clients:

- Electron desktop: the voice-first, always-ready presence.
- `jarvis` CLI: a Codex/Claude-style interactive terminal application.

The daemon exclusively owns SQLite, active turns, providers, model bootstrap, local voice runtime, and event streaming. Desktop and CLI attach to it, share conversation history live, and can observe or interrupt the same turn.

## Core Architecture

- Replace direct client-to-database access with a loopback-only daemon launched on demand.
  - Enforce one daemon per local OS user with a lock, discovery file, random local auth token, health endpoint, and reconnect handling.
  - Electron and CLI attach to an existing daemon; either client starts it if absent.
  - Run the Electron voice host hidden when the CLI starts JARVIS without a visible desktop window, preserving wake listening, speech, and barge-in behavior.
  - Serialize active work per conversation. All attached clients receive the same assistant, transcript, token, playback, cancellation, and error events.

- Keep the desktop product voice-first.
  - Retain the full lifecycle: bootstrap → wake listening → capture → transcribing → thinking → speaking → follow-up listening.
  - Closing the desktop window minimizes to tray; only explicit Quit stops the microphone and daemon.
  - Text remains a secondary surface into the same session and can interrupt speech.

- Implement the local voice runtime as Electron renderer/workers backed by TypeScript and ONNX:
  - openWakeWord TypeScript port using the requested `hey_jarvis_v0.1.onnx`, `melspectrogram.onnx`, and `embedding_model.onnx` assets.
  - Local VAD for utterance boundaries and barge-in detection.
  - Whisper ONNX as a complete verified bundle: encoder, decoder, tokenizer, configs, feature extractor, and generation assets.
  - Kokoro v1.0 with `kokoro-v1.0.onnx`, `voices-v1.0.bin`, streamed sentence playback, and `bf_isabella` as the persisted default voice. Use `kokoro-js` for its JavaScript phonemization and local ONNX execution support. [Kokoro.js](https://www.npmjs.com/package/kokoro-js)
  - Bootstrap all models into application data only, with pinned sources/revisions, hashes, retry/repair, source/license display, and no model files in Git or the installer.
  - Benchmark actual execution-provider and speech latency to choose local tuning; use WebGPU only after a real probe, otherwise CPU/WASM.

## CLI Experience

- Make `jarvis` launch an Ink-based interactive terminal UI by default.
  - Full-screen conversation transcript with streaming Markdown, code blocks, status line, scrollback, multiline composer, connection state, selected provider/model, active conversation, and current voice state.
  - Input is real assistant interaction, not a raw text pass-through: show partial voice transcripts, model/bootstrap progress, streamed assistant output, cancellations, and failures as first-class terminal events.
  - Attach to a live voice session started by the desktop app, or start the hidden voice host when invoked alone.

- Add a small, real command surface without pretending skills or agents exist:
  - `/new`, `/sessions`, `/resume`, `/provider`, `/model`, `/voice`, `/listen`, `/mute`, `/interrupt`, `/doctor`, `/workspace`, `/settings`, `/help`, and `/exit`.
  - Commands invoke daemon capabilities and return structured status/error cards; ordinary input sends an assistant turn.
  - Keep `jarvis ask "…"`, `jarvis doctor`, `jarvis workspace …`, `jarvis daemon`, and `jarvis serve` as compact non-interactive/developer commands.
  - Allow terminal and desktop clients to resume the same conversation by ID and display updates made by the other client without reload.

## Interfaces and Data

- Define one shared assistant event contract for desktop, CLI, and local API:
  - `session`, `voice-state`, `partial-transcript`, `final-transcript`, `turn-start`, `token`, `sentence-ready`, `playback`, `turn-complete`, `cancelled`, `bootstrap-progress`, and `error`.
- Expose authenticated loopback endpoints/SSE for daemon status, session/conversation management, turn streaming/cancellation, model bootstrap, voice controls, diagnostics, and workspace management.
- Add typed Electron IPC only for renderer-safe daemon and voice controls; keep Node privileges out of the renderer.
- Persist conversation origin (`voice`, `desktop-text`, `cli`), voice/model preferences, bootstrap asset state, tuning profile, and active-session metadata. Do not persist raw audio by default.
- Preserve existing provider adapters and cloud approval rules. CLI cloud use requires explicit per-turn confirmation just as desktop does.

## Test Plan

- Test daemon singleton startup, client attach/reconnect, token authorization, safe shutdown, SQLite ownership, and event fan-out to simultaneous desktop/CLI clients.
- Test cross-client behavior: create in CLI/resume in desktop, voice turn visible in CLI, CLI interruption halts desktop playback and provider streaming, and resumed conversations preserve ordered history.
- Add TTY integration/snapshot tests for slash commands, streaming Markdown, multiline entry, bootstrap progress, unavailable provider/model states, cancellation, and non-interactive JSON output.
- Test first-run model bootstrap, corrupted/incomplete Whisper bundles, download resumption, hashes, repairs, asset license metadata, voice selection persistence, and real benchmark fallback.
- Preserve and extend voice tests for wake detection, silence, false activation, VAD segmentation, partial/final transcripts, sentence streaming, barge-in, tray lifecycle, hidden voice host, permission denial, and explicit Quit.
- Smoke-test Windows first, then macOS and Linux for Electron permissions, hidden host startup, CPU fallback, WebGPU fallback, local model-cache reuse, and CLI/desktop session interoperability.

## Assumptions

- Electron is the supported user-facing desktop host; Windows, macOS, and Linux are in scope. iOS requires a separate native host later.
- English is the only initial speech language.
- The daemon starts/maintains a hidden Electron voice host when launched from the CLI alone.
- Bootstrap owns wake/STT/TTS assets and tuning. It detects and recommends local LLM configuration but does not automatically download/manage a primary LLM in this phase.
- Skills, MCP, agent orchestration, remote memory sync, autonomous edits, and self-evolution remain intentionally deferred; the clients must nevertheless have the interaction model and command structure to accommodate them later.
