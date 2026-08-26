# Phase 6: Runtime reliability

Lifecycle: Planned

## Required outcome

Daemon startup, data migration, voice initialization, CLI execution, and
multi-agent coordination have deterministic lifecycle behavior. Each operation
either reaches a verified ready or complete state or returns a failure that
accurately describes what did not complete.

## Dependencies

Phases 1 through 5 shall pass. This phase relies on their authorization,
storage, routing, identity, transport, and status contracts.

## Ownership

- `lib/daemon.mjs` owns single-instance locking, initialization, readiness,
  shutdown, and discovery publication.
- `lib/data-migration.mjs` owns directory migration semantics.
- `lib/model-bootstrap.mjs` owns model acquisition and installation integrity.
- `lib/voice-runtime.mjs` and `src/voice/` own voice state and capture flow.
- Electron voice-host components own the single renderer microphone session.
- `bin/jarvis.mjs` owns process exit status and terminal event handling.
- `lib/agents/coordinator.mjs` owns panel and debate aggregation.

## Requirements

### P6-R01: Atomic daemon ownership

The daemon shall acquire single-instance ownership through an atomic create or
equivalent operating-system primitive. The lock record shall contain the owner
PID, creation time, and instance identity before another starter can inspect it.

A contender shall remove a lock only after confirming that the recorded owner
process is not alive and that no matching daemon instance owns discovery.
Missing or partially written discovery data is not evidence that a lock is
stale. The PID, instance identity, and authenticated ownership response shall
refer to the same owner before a contender uses them as evidence.

Ownership liveness is distinct from client readiness. An authenticated
`GET /daemon/status` response from the recorded instance shall return its PID,
instance identity, and lifecycle state. A matching response in `starting`,
`ready`, `degraded`, or `stopping` state counts as live. A transport failure
alone does not establish staleness; the recorded process must also be absent
or fail the instance-identity check.

Startup failure and normal shutdown shall close HTTP, provider, worker, and
database resources before releasing the lock and discovery record owned by
that instance. Normal shutdown shall also wait for voice-model acquisition to
settle, so no install writes into the model root after `close()` returns.

### P6-R02: Readiness publication

The daemon shall distinguish `starting`, `ready`, `degraded`, and `stopping`.
Discovery may identify a starting instance, but health shall not report ready
and clients shall not submit turns until required database, registry, and event
infrastructure is initialized.

The ownership probe shall accept every lifecycle state as proof that the
matching instance still owns the lock. Readiness controls whether clients may
submit work; it does not authorize another starter to replace a live owner.

Optional voice-model availability may produce a documented degraded state
while text operation remains ready. The health response shall list the
degraded subsystem and recovery action.

Core initialization shall make database, registry, routing, and event services
ready before discovery advertises text readiness. Voice-model validation and
acquisition shall continue through the voice subsystem's degraded/bootstrap
state without blocking creation of the Electron window or text clients.

### P6-R03: Directory migration

Migration shall support an absent destination, an existing empty destination,
and an existing populated destination on Windows and Linux. Moving into an
existing empty directory shall move the source contents into that directory or
remove the verified empty destination before an atomic directory move.

Migration shall copy or move into a staging location, validate expected files,
publish the destination, and then retire the source according to the selected
policy. An interruption before publication shall leave one complete usable
copy. Re-running migration shall converge on the same result.

### P6-R04: Model acquisition

Each remote model artifact shall have a manifest entry containing an immutable
source revision, expected byte size, and cryptographic digest. Downloads shall
use connection and total-operation timeouts, cancellation, temporary files,
digest verification, and atomic publication.

Every manifest URL shall resolve through the same immutable revision recorded
by its manifest entry. Mutable branch URLs such as `resolve/main` shall be
replaced with a tag or commit URL; the Silero VAD entry shall be pinned in the
same manner as the Whisper entry.

An existing artifact is usable only after manifest validation. Invalid files
shall be replaced through the same temporary download path. Startup shall not
wait indefinitely for a model source; failure places voice in a diagnosable
degraded state and preserves text readiness.

Repeated startup shall skip artifacts already validated.

### P6-R05: Voice state persistence

Operator-selected voice, listening enabled state, and interaction mode shall
persist through the daemon-owned settings store. Transient states such as
capturing, thinking, speaking, interruption, and bootstrap progress reset to a
safe startup state.

`voice.mode`, `voice.enabled`, and the selected Kokoro voice are durable
settings. `voice.runtime` is diagnostic history and shall not restore a
transient state after process startup. Startup computes its initial state from
current model and renderer readiness.

The daemon API, Voice HUD, agent voice selectors, and renderer worker shall use
the same voice catalog returned by the voice runtime.

### P6-R06: Bounded audio processing

The wake worker shall use a bounded frame queue or ring buffer with a documented
latency budget. The default queued-audio duration shall not exceed one second.
When processing falls behind, the worker shall apply a deterministic overflow
policy and emit a diagnostic counter; queued latency shall not grow without
bound.

Frame processing shall avoid repeated whole-buffer spread and slice operations
on the streaming hot path.

### P6-R07: Single voice capture and event ownership

The renderer shall have one microphone stream and one audio-processing owner.
Voice HUD controls send capture, interrupt, mode, and listening commands to
that owner; opening the HUD shall not open another microphone stream.

Voice status shall have one shared SSE subscription per renderer. Push-to-talk
shall start worker capture. Interrupt shall cancel capture, provider work, and
active playback as applicable, then report the resulting state from the daemon
or owning runtime rather than applying a cosmetic state change.

### P6-R08: CLI process result

One-shot CLI commands shall exit zero only when the requested operation
completes successfully. Stream `error` and `cancelled` events, unavailable
providers, approval denials, invalid identifiers, and failed agent runs shall
produce a nonzero exit status.

Human-readable and JSON modes shall represent the same result. Plain and TUI
event handlers shall recognize every terminal event defined by the daemon
contract. Successful `doctor`, `daemon`, settings, and list operations retain
zero exit status.

### P6-R09: Panel and debate synthesis

Panel mode shall gather every selected agent result and pass the labelled
results to a designated synthesizer. Debate mode shall pass initial positions
and labelled critiques to the final synthesizer. The final prompt shall include
the complete bounded evidence being synthesized.

The recorded result shall distinguish participant output from synthesis.
Missing participant output, timeout, or failure shall be represented in the
synthesis input and run metadata. The Phase 1 authorization context applies to
every participant and synthesis call.

The UI shall submit the operator-selected agent IDs for every mode and shall
derive displayed approval requirements from the actual selected profiles. The
daemon shall authorize each selected profile from the Phase 1 grant; a client
boolean cannot create or substitute for that grant.

Panel and debate controls shall expose multi-selection. When the operator
selects one or more agents, the request contains exactly those IDs. When the
operator leaves the selection empty, the request omits agent IDs and the daemon
uses its documented default set. Panel defaults are `architect`, `reviewer`,
and `security`. Debate defaults are `architect`, `reviewer`, and `adversary`.
The GUI shall initialize multi-selection without selected agent IDs so each
mode uses its documented default until the operator makes a selection.

## Implementation targets

- `lib/daemon.mjs`
- `lib/daemon-client.mjs`
- `lib/event-hub.mjs`
- `lib/data-migration.mjs`
- `lib/model-bootstrap.mjs`
- `lib/voice-runtime.mjs`
- `lib/agents/coordinator.mjs`
- `lib/agents/adapters/`
- `electron/main.mjs`
- `electron/kokoro-onnx-worker.mjs`
- `src/voice/VoiceHost.tsx`
- `src/voice/wake-worker.ts`
- `src/App.tsx`
- `src/hooks/useVoiceStatus.ts`
- `src/components/VoiceHudView.tsx`
- `src/components/AgentOrchestrationView.tsx`
- `bin/jarvis.mjs`
- daemon, migration, model-bootstrap, voice, CLI, and agent-runtime tests

## Implementation sequence

1. Implement atomic lock records, stale-owner verification, startup cleanup,
   and readiness states. Keep ownership liveness independent from readiness
   status. Split core text readiness from voice-model bootstrap so cold model
   acquisition does not block the Electron window.
2. Make directory migration staged, validated, idempotent, and compatible with
   an existing empty Windows destination.
3. Add model manifest integrity, immutable URL/revision agreement, bounded
   downloads, atomic publication, and degraded voice startup.
4. Persist durable voice settings and centralize the voice catalog.
5. Replace the audio array queue with a bounded structure.
6. Make VoiceHost the renderer capture owner and route every HUD action through
   it; share one voice event subscription.
7. Derive CLI exit status from the terminal operation result.
8. Feed participant evidence into panel/debate synthesis, initialize the GUI
   with an empty selection, implement the documented default sets, and validate
   actual UI agent selection through the daemon-owned approval policy.

## Verification

Start two daemon contenders against one temporary data root and prove one owner
through startup, degraded readiness, and shutdown. Run the existing-empty
migration case on Windows. Use a local model fixture for one valid download and
one timeout or digest failure.

Focused voice checks shall cover durable settings and bounded queue behavior.
CLI checks shall cover one success and one terminal failure. Agent checks shall
cover the two default rosters, an explicit selection, and synthesis containing
the participant results.

```text
npm run lint
```

## Exit conditions

Phase 6 is complete only when:

- concurrent startup produces one daemon owner and deterministic cleanup;
- every lifecycle state preserves ownership until the matching owner releases
  it;
- readiness reflects completed initialization and named degraded subsystems;
- migration handles a real Windows existing-empty destination;
- model artifacts are bounded, verified, and atomically published;
- voice queue duration is bounded and the renderer owns one capture/event path;
- CLI failure cases return nonzero;
- panel and debate use the documented roster or exact operator selection, and
  synthesis inputs contain actual participant evidence; and
- the focused runtime checks pass.
