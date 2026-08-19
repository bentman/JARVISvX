# JARVISvX — Fragmentation & Fluidity Audit

*Tech-debt review, August 2026. Scope: why the app feels like assembled parts rather than one product, and what to do about it.*

## The throughline

The daemon's bones are actually sound: one process owns SQLite state, one Express router exposes it, one `AssistantEventHub` broadcasts change over SSE, and the README already states the intended shape (loopback daemon, thin clients). That's the right architecture for "fluid" — a single source of truth that every surface subscribes to.

The fragmentation isn't that this spine is missing. It's that most of the app doesn't use it. Panels poll instead of subscribing. "Current provider" is written in four different places and read from a fifth. Voice status has three independent pollers that can disagree with each other on screen at the same time. A shared `ui/` component kit exists but individual panels bypass it or misuse it. Each new panel invents its own loading/error/success convention rather than reusing one.

That reframes the fix: this is mostly **enforcement and consolidation debt**, not a rewrite. The infrastructure to be fluid already exists in the backend; the work is retiring the four settings stores down to one, and making the frontend actually lean on the event stream and a shared component/data-hook layer instead of re-deriving state per panel.

One additional finding, visible directly in a screenshot from this session, is significant enough to call out on its own: reasoning-model output (chain-of-thought) is being piped into the chat transcript completely raw, with no separation from the final answer. That's the most visible, most damaging fragmentation symptom in the app today, and it's also the cheapest to fix — see Finding 1.

## Method

This audit combined a full read of `src/` (every panel, the shared `ui/` kit, `App.tsx`, `api.ts`, `types.ts`) and `lib/` (every subsystem: agents, MCP/skills, memory, orchestrator, providers, tools, voice-runtime, the Express router, and the SQLite schema), plus external research on how comparable local-first AI assistant UIs (Open WebUI, LM Studio, Jan, AnythingLLM, LibreChat) and chat-UI component libraries (assistant-ui) handle the same problems — provider/settings unification, connection-status conventions, and reasoning-model display in particular, since that pattern is now industry-standard and directly diagnoses Finding 1.

## Findings

Scored on the skill's model: **Priority = (Impact + Risk) × (6 − Effort)**, each on a 1–5 scale, effort inverted (1 = trivial, 5 = large). Higher priority = do sooner.

| # | Finding | Category | Impact | Risk | Effort | Priority |
|---|---|---|---|---|---|---|
| 1 | Raw chain-of-thought leaks into chat, unrendered | Code / UX | 5 | 3 | 2 | **32** |
| 2 | "Current provider/model" fragmented across 4 stores, one dead | Architecture | 5 | 5 | 3 | **30** |
| 3 | Two live provider systems + two REST surfaces for one resource | Code / Architecture | 3 | 3 | 2 | **24** |
| 4 | No unified event participation; 3 disagreeing voice-status pollers | Architecture | 4 | 3 | 3 | **21** |
| 5 | Shared `ui/` kit exists but is bypassed/misused per panel | Code | 3 | 2 | 2 | **20** |
| 6 | Agent runtime bypasses `chat()`'s provider/cloud-approval pipeline | Architecture / Safety | 4 | 5 | 4 | **18** |
| 7 | Memory auto-summarize has no LLM logic despite the name | Code / Docs | 2 | 2 | 2 | **16** |
| 8 | Inconsistent id/CRUD conventions across subsystems | Code | 2 | 2 | 3 | **12** |

Secondary, lower-scored but worth tracking: zero test coverage on the provider-registry/routing code added this session (**Test debt**); no ADR recording *why* `/providers` and `/provider-registry` coexist (**Documentation debt** — I added an inline code comment during the routing fix, but nothing durable in `docs/`).

---

### 1. Raw chain-of-thought leaks into the chat transcript — Priority 32

**What's happening.** `src/App.tsx` renders every message as `<p>{message.content}</p>` — no markdown, no tag parsing, no segment separation. `lib/application.mjs`'s `chat()` streams every token from the provider straight into `message.content` with no awareness that a reasoning model emits a `<think>...</think>` (or a structured `reasoning_content` delta) ahead of its real answer. The screenshot from this session shows exactly this: a wall of "But caution... but careful... but instructions say..." internal deliberation, with the actual one-line answer ("Washington, D.C.") buried inside it.

**Why it's the top item.** It's the single most visible thing a user sees, it reads as broken rather than "has an extra feature," and reasoning models (the exact class this project is choosing to support — `unsloth/Phi-4-reasoning-plus`) are now common enough that every comparable product has already solved this the same way.

**Common practice.** [Open WebUI](https://docs.openwebui.com/features/chat-conversations/chat-features/reasoning-models/) detects reasoning two ways — scanning stream text for `<think>`/`<thinking>` tags, or reading a structured `reasoning_content`/`reasoning` delta field when the provider exposes one — and renders the extracted span in a collapsible "Thought" element, keeping the transcript clean while the reasoning stays inspectable. It also re-serializes the thinking block into subsequent turns so multi-turn tool use still has the model's own prior reasoning available. [assistant-ui](https://www.assistant-ui.com/docs/guides/chain-of-thought), a chat-UI component library, models this as a first-class message-part type (`ReasoningRoot`/`ReasoningTrigger`/`ReasoningContent`, grouped via `MessagePrimitive.GroupedParts`) with a `streaming` prop so the "Thinking…" affordance updates live rather than needing the full response first. Both converge on the same shape: detect the reasoning span (tag or structured field), keep it structurally distinct from the final-answer text, render it collapsed by default.

**Fix, scoped.** Backend: in `lib/application.mjs`'s streaming loop, split tokens on `<think>`/`</think>` (or the provider's structured reasoning field, since `lib/providers/*.mjs` already parses SSE deltas per-protocol) and emit a `reasoning` token-type alongside the existing `token` type, rather than concatenating both into one `content` string. Frontend: one small `<Thinking>` component (collapsible, default-collapsed, live-updating while streaming) consumed by the existing message-render loop in `App.tsx`. This is genuinely a day or two of work, isolated to one streaming path and one render component — it doesn't touch the provider registry, routing, or any other subsystem.

### 2. "Current provider/model" is fragmented across four stores, one already dead — Priority 30

`db.setting('provider.active', id)` is written by `POST /settings/active-provider` and **never read by anything** — `settings()` instead derives the active provider from `registry.list()[0]` by priority. The actual per-provider model choice lives at a different key, `provider.model.<id>`. Provider *selection policy* (auto/local-only/cloud-only, escalation rules) lives in a separate `orchestrationSettings()` blob. Provider *availability/ordering* lives in the `providers` table's own `enabled`/`priority` columns. Four places, no single object any panel can read to answer "what will actually handle the next message" — which is exactly the class of bug that produced the cloud-approval gap fixed earlier this session (the frontend's notion of "the active provider" and the backend's had already drifted apart once).

**Fix, scoped.** Not a rewrite — a consolidation. Pick the registry + `orchestrationSettings()` as the two authoritative stores (they're the ones actually read), delete the dead `provider.active` write path, and expose one `GET /api/settings/effective` (or similar) that folds both into the single object panels should read, instead of each panel re-deriving "active provider" its own way (as `App.tsx`, `SettingsPanel.tsx`, and `ProvidersView.tsx` currently each do independently).

### 3. Two live provider systems, two REST surfaces for one resource — Priority 24

`lib/providers.mjs` (fixed-id classes: `'llamacpp'`, `'ollama'`, `'cloud'`) is dead code — nothing imports it anymore — but it's still in the tree, and it's the thing `README.md`'s architecture diagram still names. The live path is the DB-backed registry (`lib/providers/`), fronted by two separate endpoints, `/api/providers` (legacy settings+health shape) and `/api/provider-registry` (CRUD), which have to coexist because the first was already load-bearing when the second was added this session. That split is documented in code comments as deliberate, but it's a patch, not a design — anyone who doesn't read that comment will reasonably try to merge them back into one route and reintroduce the shadowing bug that was just fixed.

**Fix, scoped.** Delete `lib/providers.mjs`. Write a short ADR (even five sentences in `docs/`) recording why two `/providers*` routes exist and what would have to change to retire one — so the next person doesn't rediscover this by breaking it.

### 4. No unified event participation; three voice-status pollers that can disagree — Priority 21

`App.tsx`, `VoiceHudView.tsx`, and `VoiceControls.tsx` each independently poll `GET /api/voice` on different intervals (3s, 1s, 1s) and keep separate local copies of mode/voice/state, even though `AssistantEventHub`/SSE already exists and voice-runtime already publishes to it. Meanwhile MCP, skills, memory, orchestration, and provider CRUD are pure request/response even for actions that are logically async (ping, test-connection, execute) — so those panels invented their own manual "click to refresh" instead of getting pushed an update. This is the concrete mechanism behind "not fluid": two parts of the same screen showing the assistant as listening and as muted at the same moment, because they're not reading from the same place.

**Fix, scoped.** Standardize on "the daemon publishes, panels subscribe." Collapse the three voice pollers into one hook consuming the existing SSE stream. Extend `publish()` calls to the async actions above so their panels can drop manual refresh-polling too. This can be done incrementally, one panel at a time, whenever that panel is next touched for a feature — it doesn't need a dedicated sprint.

### 5. Shared `ui/` kit exists but is bypassed or misused — Priority 20

`McpSkillsView.tsx` hand-rolls three modals instead of using the existing `Modal.tsx`. `ProvidersView.tsx` passes a `label` prop to `SectionDivider` that the component doesn't accept — it's silently a no-op, a live example of a panel and the "shared" kit having already drifted apart. Status is shown three different ways across panels (a `StatusBadge` component, raw `.online-dot`/`.offline-dot` spans, and ad-hoc colored Tailwind badges), and "it saved" feedback is reinvented per panel (`savedSuccess` + `setTimeout` in two places independently, native `alert()` in a third).

**Fix, scoped.** No new components needed — mostly retrofitting existing ones. Add one shared toast/notification hook (small, a day), fix the `SectionDivider` prop drift, and swap McpSkillsView's hand-rolled modals for the existing `Modal.tsx`. Treat "use the shared kit" as a lint-level review checklist item for any panel touched going forward rather than a one-time sweep, so it doesn't drift again.

### 6. Agent runtime bypasses `chat()`'s provider/cloud-approval pipeline — Priority 18

Most default agents use the `'acp'` adapter, which shells out to external CLIs (`claude`, `codex`, `copilot`, `cline`) and never touches the provider registry, `routeTurn()`, or cloud-approval gating at all. The `'process'` adapter does call `getProvider()`, but skips `chat()`'s model-fallback chain entirely. There's also an orphaned `AgentBusMcpServer`, instantiated but never wired into `/mcp` or `api.mjs` — dead code duplicating `mcp-skills.mjs`'s tool-exec pattern. Functionally this means the cloud-approval guarantee fixed earlier this session covers `chat()` but not agent runs — the same category of gap, in a second place.

**Fix, scoped.** Larger than the others — this is reconciling two genuinely different execution models (in-process provider chat vs. shelling out to an external CLI), not just wiring plumbing. Minimum viable fix: explicitly document which adapters are exempt from cloud-approval and why, and decide deliberately (not by omission) whether ACP-adapter runs need their own approval gate. Remove the dead `AgentBusMcpServer` or wire it in — pick one.

### 7. Memory auto-summarization has no LLM logic — Priority 16

`autoSummarizeConversations()` is pure regex heuristics (`/prefer|always|never|.../i`) with no provider argument at all — despite living next to, and being named like, the rest of the LLM-driven pipeline. Not broken, but it will surprise the next person who assumes "auto-summarize" means an LLM call, and it's a one-line documentation/naming fix away from being honest about what it does.

### 8. Inconsistent id/CRUD conventions across subsystems — Priority 12

Four different id schemes coexist (`crypto.randomUUID()` for conversations/messages/roots/runs; `prefix-${Date.now()}-${rand}` with inconsistent random ranges for providers/memories/MCP servers/skills; fixed semantic slugs for agents) and four different REST shapes for "manage a list of things" (plain CRUD, CRUD+toggle, CRUD+search, action-verb endpoints for workspace edits). Lowest priority because nothing is actually broken by this today — it's pure future-maintenance cost. Worth a one-page convention doc applied going forward rather than a migration.

## Phased remediation plan

Designed to run alongside feature work, not as a stop-everything rewrite — most items are scoped to be picked up incrementally.

**Phase 0 — this week (quick wins, ~2–4 days total).** Finding 1 (reasoning-leak fix — highest visible impact, lowest effort), Finding 3's dead-code deletion (`lib/providers.mjs`) plus a short ADR, Finding 5's `SectionDivider` prop-drift fix. These are independent, low-risk, and each shippable on its own.

**Phase 1 — next 1–2 weeks (foundational, unblocks everything else).** Finding 2: consolidate the four provider/settings stores into one authoritative read path (`GET /api/settings/effective` or equivalent). This is the one item worth doing as dedicated work rather than incrementally, because every panel in Phase 2 should be retrofitted to read from the *result* of this consolidation, not the four sources it replaces.

**Phase 2 — following 2–3 weeks, interleaved with feature work.** Finding 4 (collapse the three voice pollers into one SSE subscription; extend event-hub publishing to async CRUD actions) and Finding 5's toast/modal retrofits, done panel-by-panel whenever that panel is next opened for a feature change — a strangler-fig approach rather than a big-bang UI rewrite.

**Phase 3 — longer tail, ongoing.** Finding 6 (agent runtime/cloud-approval reconciliation — needs a deliberate design decision, not just plumbing), Finding 7 (rename or wire up memory auto-summarize), Finding 8 (apply a written id/CRUD convention to new resources; don't migrate existing tables). Also: backfill test coverage for the provider-registry/routing code from this session, and start an ADR log in `docs/` so decisions like the `/providers` split stop needing to be rediscovered by reading code comments.

## Business case, in one paragraph

None of this is abstract cleanliness. Finding 1 is what a user sees in the first five minutes with a reasoning model and will read as "this product is broken." Finding 2 already caused a real regression this session (the cloud-approval gap) and will keep producing that class of bug until it's fixed, because there's structurally no single place left to check. Findings 3–8 are what make every future panel and every future provider integration cost more than the last one, compounding — the "fragmentation" feeling the app has today is the visible symptom of that compounding, not a separate problem from it.
