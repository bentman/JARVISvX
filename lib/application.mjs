import { JarvisDatabase } from './database.mjs'; import { diagnostics } from './diagnostics.mjs'; import { ProviderRegistry, ProviderError } from './providers/index.mjs'; import { canonicalRoot, readWorkspaceFile, writeWorkspaceFile, searchWorkspace, registeredTools } from './tools.mjs';
import { AssistantEventHub } from './event-hub.mjs'; import { VoiceRuntime } from './voice-runtime.mjs';
import { pingMcpServer as pingMcp, executeMcpTool as execTool, executeSkill as execSkill } from './mcp-skills.mjs';
import { listStdioTools } from './mcp-stdio.mjs';
import { getHardwareProfile, pingLocalEndpoint as pingLocal, evaluateTurnRouting, routeTurn } from './orchestrator.mjs';
import { extractMemoryFactsByRegex } from './memory-engine.mjs';
import { AgentRuntime } from './agents/runtime.mjs';
import { createReasoningSplitter } from './reasoning-stream.mjs';
import { buildCapabilityRegistry, describeCapabilities } from './capabilities.mjs';

const MAX_TOOL_ROUNDS = 4;

export function createJarvisApp({ database, events = new AssistantEventHub() } = {}) {
  const db = database || new JarvisDatabase();
  const registry = new ProviderRegistry({ database: db }).reload();
  const active = new Map();
  const publish = (event) => events.publish(event);
  const voice = new VoiceRuntime({ database: db, publish });
  const agentRuntime = new AgentRuntime({ database: db, getProvider: (id) => appObj.getProvider(id), publish });

  const appObj = {
    db, registry, events, voice, agentRuntime,
    // Backward-compat alias: expose flat list as .providers for diagnostics/health
    get providers() { return registry.list(); },

    async initialize() { await voice.initialize(); await agentRuntime.initialize(db.roots().map((r) => r.path)); return this; },

    getProvider(id) {
      if (!id) return registry.getDefault();
      const p = registry.get(id);
      if (!p) throw new ProviderError(`Provider '${id}' not found or disabled.`, 'unknown_provider');
      return p;
    },

    async health() { const info = await diagnostics(registry.list()); return { status: 'ok', version: '0.1.0', loopbackOnly: true, providers: info.providers }; },
    async diagnostics() { return diagnostics(registry.list()); },
    async models(providerId) { return this.getProvider(providerId).listModels(); },

    // Provider registry CRUD — hot-reload registry after each write.
    listProviders() { return db.providers().map(({ _api_key_enc, ...row }) => row); },
    getProviderRecord(id) { const r = db.provider(id); if (!r) return null; const { _api_key_enc, ...row } = r; return row; },
    addProvider(data) { const r = db.addProvider(data); registry.reload(); const { _api_key_enc, ...row } = r; return row; },
    updateProvider(id, data) { const r = db.updateProvider(id, data); if (!r) return null; registry.reload(); const { _api_key_enc, ...row } = r; return row; },
    deleteProvider(id) { const ok = db.deleteProvider(id); if (ok) registry.reload(); return ok; },
    toggleProvider(id) { const r = db.toggleProvider(id); if (!r) return null; registry.reload(); const { _api_key_enc, ...row } = r; return row; },
    async testProvider(id) {
      const row = db.provider(id);
      if (!row) throw new ProviderError('Provider not found.', 'not_found');
      const instance = registry.instanceFromRow(row);
      if (!instance) throw new ProviderError(`Unsupported protocol: ${row.protocol}`, 'unsupported_protocol');
      const start = Date.now();
      const health = await instance.health();
      return { ...health, latencyMs: Date.now() - start };
    },

    conversations: () => db.conversations(), conversation: (id) => { const item = db.conversation(id); return item && { ...item, messages: db.messages(id) }; }, createConversation(title) { return db.createConversation(title); }, deleteConversation(id) { return db.deleteConversation(id); },
    agents: () => agentRuntime.listAgents(),
    agent: (id) => agentRuntime.getAgent(id),
    executeAgentRun: (options) => agentRuntime.executeRun(options),
    agentRuns: (conversationId) => db.agentRuns(conversationId),
    // Agent-to-agent delegation tools (agents_list/agents_ask/agents_send, with a
    // depth-2 delegation cap). Served at GET/POST /api/agent-bus/*; agents_list and
    // agents_ask are also part of the model-callable capability registry
    // (lib/capabilities.mjs) that chat() builds below.
    agentBusTools: () => agentRuntime.busMcp.getTools(),
    executeAgentBusTool: (toolName, params, context) => agentRuntime.busMcp.executeTool(toolName, params, context),

    mcpServers: () => db.mcpServers(), mcpServer: (id) => db.mcpServer(id),
    // 'sse' is rejected here rather than left to fail on first tool call — the
    // Add MCP Server form (McpSkillsView.tsx) also marks it unavailable; that
    // transport is not implemented yet. 'stdio' gets its declared tools from a
    // real connection (spawn + initialize + tools/list, see lib/mcp-stdio.mjs)
    // instead of trusting whatever tool list the caller supplied — a stdio
    // server's actual tools are only knowable by asking it.
    async addMcpServer(data) {
      if (data.type === 'sse') throw new ProviderError('The SSE MCP transport is not implemented yet. Use HTTP JSON-RPC or a local stdio command.', 'not_implemented');
      if (data.type === 'stdio') {
        let tools;
        try { tools = await listStdioTools(data.endpoint); }
        catch (error) { throw new ProviderError(`Could not connect to the MCP server: ${error.message}`, 'mcp_stdio_unreachable'); }
        return db.addMcpServer({ ...data, tools });
      }
      return db.addMcpServer(data);
    },
    deleteMcpServer: (id) => db.deleteMcpServer(id), async pingMcpServer(id) { const server = db.mcpServer(id); if (!server) throw new ProviderError('MCP Server not found.', 'not_found'); return pingMcp(server); },
    async executeMcpTool(serverId, toolName, params) { const server = db.mcpServer(serverId); if (!server) throw new ProviderError('MCP Server not found.', 'not_found'); return execTool(server, toolName, params, appObj); },
    skills: () => db.skills(), skill: (id) => db.skill(id), addSkill: (data) => db.addSkill(data), updateSkill: (id, updates) => db.updateSkill(id, updates), deleteSkill: (id) => db.deleteSkill(id), toggleSkill: (id) => db.toggleSkill(id),
    async executeSkill(idOrCmd, input = '') { const target = db.skill(idOrCmd) || db.skillByCommand(idOrCmd); if (!target) throw new ProviderError('Skill not found.', 'not_found'); return execSkill(target, input, appObj); },

    async *chat({ conversationId, content, providerId, userOverrideProvider, model, allowCloud = false, allowToolWrites = false, signal, origin = 'desktop-text' }) {
      if (!content?.trim()) throw new ProviderError('Message is required.', 'validation');
      const text = content.trim();
      const conversation = conversationId ? db.conversation(conversationId) : db.createConversation(text.slice(0, 60));
      if (!conversation) throw new ProviderError('Conversation not found.', 'not_found');

      // Slash skill routing (unchanged)
      if (text.startsWith('/')) {
        const parts = text.split(' '); const cmd = parts[0]; const argInput = parts.slice(1).join(' ');
        const matchedSkill = db.skillByCommand(cmd);
        if (matchedSkill && matchedSkill.enabled) {
          if (active.has(conversation.id)) throw new ProviderError('This conversation already has an active turn.', 'turn_active');
          const controller = new AbortController(); const turnId = crypto.randomUUID();
          active.set(conversation.id, { controller, turnId });
          if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
          db.addMessage(conversation.id, 'user', text, null, 'complete', origin);
          yield { type: 'start', conversationId: conversation.id, turnId, provider: 'skill', model: matchedSkill.slashCommand };
          publish({ type: 'session', state: 'turn-start', conversationId: conversation.id, turnId, origin });
          try {
            if (controller.signal.aborted) throw new ProviderError('Request cancelled.', 'cancelled');
            const skillResult = await execSkill(matchedSkill, argInput, appObj);
            if (controller.signal.aborted) throw new ProviderError('Request cancelled.', 'cancelled');
            const outputText = skillResult.output || 'Skill executed successfully.';
            db.addMessage(conversation.id, 'assistant', outputText, 'skill', 'complete', origin);
            const tokenEvent = { type: 'token', value: outputText, conversationId: conversation.id, turnId };
            publish(tokenEvent); yield tokenEvent;
            const done = { type: 'turn-complete', conversationId: conversation.id, turnId }; publish(done); yield done; return;
          } catch (err) {
            const cancelled = controller.signal.aborted || err.code === 'cancelled';
            const errorText = cancelled ? 'Request cancelled.' : `Failed to execute skill ${cmd}: ${err.message}`;
            db.addMessage(conversation.id, 'assistant', errorText, 'skill', cancelled ? 'cancelled' : 'error', origin);
            const errEvent = { type: cancelled ? 'cancelled' : 'error', code: cancelled ? 'cancelled' : 'skill_error', conversationId: conversation.id, turnId, message: cancelled ? 'Request cancelled.' : err.message };
            publish(errEvent); yield errEvent; return;
          } finally { active.delete(conversation.id); }
        }
      }

      // Provider selection: explicit ID → getProvider() (testable, exact), otherwise routeTurn() for tag-based auto-routing.
      const orchSettings = db.orchestrationSettings();
      let selected;
      if (providerId || userOverrideProvider) {
        // Direct selection — respects mocked getProvider in tests and explicit user overrides.
        try { selected = appObj.getProvider(userOverrideProvider || providerId); } catch {}
        // Explicit selection of a cloud-tagged provider still requires per-turn approval.
        if (selected && selected.tags?.includes('cloud') && !allowCloud) {
          throw new ProviderError('Cloud requests require explicit approval.', 'cloud_approval_required');
        }
      }
      if (!selected) {
        const { provider, reason, needsCloudApproval } = routeTurn(text, {
          mode: orchSettings.mode,
          userOverrideProvider: userOverrideProvider || null,
          allowCloud,
          autoEscalateRules: orchSettings.autoEscalateRules,
        }, registry);
        if (!provider) {
          if (needsCloudApproval) throw new ProviderError('Cloud requests require explicit approval.', 'cloud_approval_required');
          throw new ProviderError(reason || 'No providers available. Add a provider in the Providers panel.', 'no_providers');
        }
        selected = provider;
      }

      const selectedModel = model || db.setting(`provider.model.${selected.id}`, null) || (await selected.listModels().catch(() => []))[0] || selected.model || '';
      if (!selectedModel) throw new ProviderError(`Select a model for ${selected.label}.`, 'model_required');
      if (!db.setting(`provider.model.${selected.id}`, null)) db.setSetting(`provider.model.${selected.id}`, selectedModel);

      if (active.has(conversation.id)) throw new ProviderError('This conversation already has an active turn.', 'turn_active');
      const controller = new AbortController(); const turnId = crypto.randomUUID();
      active.set(conversation.id, { controller, turnId });
      if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
      db.addMessage(conversation.id, 'user', text, null, 'complete', origin);
      const history = db.messages(conversation.id).map((message) => ({ role: message.role, content: message.content }));
      let output = '';
      yield { type: 'start', conversationId: conversation.id, turnId, provider: selected.id, model: selectedModel };
      publish({ type: 'session', state: 'turn-start', conversationId: conversation.id, turnId, origin });
      if (origin === 'voice') voice.setSession(conversation.id, 'thinking', turnId);
      // Reasoning models (Phi-4-reasoning, DeepSeek-R1-distill, QwQ, ...) emit their
      // chain-of-thought inline, wrapped in <think>...</think>. Split that out into its
      // own 'reasoning' event so it's viewable live (a collapsible "thinking" affordance
      // in the UI) without ever landing in `output` — the persisted, logged message.
      function* emitPieces(pieces) {
        for (const piece of pieces) {
          const event = { type: piece.type === 'reasoning' ? 'reasoning' : 'token', value: piece.text, conversationId: conversation.id, turnId };
          if (piece.type !== 'reasoning') output += piece.text;
          publish(event); yield event;
        }
      }
      // Capabilities: the same registry a model can invoke directly during this
      // loop (see lib/capabilities.mjs and docs/adr-0002-unified-capability-registry.md).
      // Only offered to providers that opt into tool-calling (selected.supportsToolCalling)
      // — Anthropic's and Gemini's wire protocols would misinterpret a `role: 'system'`
      // message inside `messages` or an unexpected `tools` field rather than ignore it,
      // so this stays a no-op for them until they're updated (ADR 0002, Phase A vs B).
      // A capability summary is prepended to the provider-facing messages only —
      // never persisted, same treatment as reasoning tokens below.
      const capabilities = selected.supportsToolCalling ? buildCapabilityRegistry(appObj, { conversationId: conversation.id, allowCloud }) : [];
      const toolByName = new Map(capabilities.map((tool) => [tool.name, tool]));
      const toolSchemas = capabilities.map(({ name, description, parameters }) => ({ name, description, parameters }));
      const capabilityPrompt = describeCapabilities(capabilities);
      let providerMessages = capabilityPrompt ? [{ role: 'system', content: capabilityPrompt }, ...history] : history;

      try {
        const splitter = createReasoningSplitter();
        let round = 0;
        while (true) {
          const pendingToolCalls = [];
          for await (const piece of selected.streamChat({ messages: providerMessages, model: selectedModel, signal: controller.signal, tools: toolSchemas.length ? toolSchemas : undefined })) {
            if (piece && typeof piece === 'object' && piece.type === 'tool_call') { pendingToolCalls.push(piece); continue; }
            yield* emitPieces(splitter.push(piece));
          }
          if (!pendingToolCalls.length) break;

          round += 1;
          if (round > MAX_TOOL_ROUNDS) {
            yield* emitPieces([{ type: 'content', text: '\n\n(Tool use limit reached for this turn.)' }]);
            break;
          }

          providerMessages = [...providerMessages, { role: 'assistant', content: '', toolCalls: pendingToolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })) }];
          for (const call of pendingToolCalls) {
            const tool = toolByName.get(call.name);
            if (!tool) {
              providerMessages.push({ role: 'tool', toolCallId: call.id, content: `Unknown tool: ${call.name}` });
              continue;
            }
            if (tool.permission === 'approval-required' && !allowToolWrites) {
              const approvalEvent = { type: 'tool-approval-required', name: tool.name, arguments: call.arguments, conversationId: conversation.id, turnId };
              publish(approvalEvent); yield approvalEvent;
              if (output) db.addMessage(conversation.id, 'assistant', output, selected.id, 'complete', origin);
              const done = { type: 'turn-complete', conversationId: conversation.id, turnId }; publish(done); yield done;
              return;
            }
            const callEvent = { type: 'tool-call', name: tool.name, arguments: call.arguments, conversationId: conversation.id, turnId };
            publish(callEvent); yield callEvent;
            let resultText;
            try {
              const result = await tool.execute(call.arguments || {});
              resultText = typeof result === 'string' ? result : JSON.stringify(result);
            } catch (toolError) {
              resultText = `Tool error: ${toolError.message}`;
            }
            const resultEvent = { type: 'tool-result', name: tool.name, output: resultText, conversationId: conversation.id, turnId };
            publish(resultEvent); yield resultEvent;
            providerMessages.push({ role: 'tool', toolCallId: call.id, content: resultText });
          }
        }
        yield* emitPieces(splitter.flush());
        db.addMessage(conversation.id, 'assistant', output, selected.id, 'complete', origin);
        if (origin === 'voice') voice.setSession(conversation.id, 'speaking', turnId);
        const done = { type: 'turn-complete', conversationId: conversation.id, turnId }; publish(done); yield done;
      } catch (error) {
        const status = controller.signal.aborted ? 'cancelled' : 'error';
        if (output) db.addMessage(conversation.id, 'assistant', output, selected.id, status, origin);
        if (origin === 'voice') voice.setSession(conversation.id, status === 'cancelled' ? 'wake-listening' : 'error', turnId);
        const event = { type: controller.signal.aborted ? 'cancelled' : 'error', code: error.code || status, conversationId: conversation.id, turnId, message: controller.signal.aborted ? 'Request cancelled.' : error.message };
        publish(event); yield event;
      } finally { active.delete(conversation.id); }
    },

    cancel(conversationId, turnId = null) { const activeTurn = active.get(conversationId); if (!activeTurn || (turnId && activeTurn.turnId !== turnId)) return false; activeTurn.controller.abort(); voice.interrupt(conversationId); return true; },
    tools: registeredTools, roots: () => db.roots(), async addRoot(rootPath) { return db.addRoot(await canonicalRoot(rootPath)); }, removeRoot(id) { return db.removeRoot(id); }, async readFile(filePath) { return readWorkspaceFile(filePath, db.roots().map((root) => root.path)); }, async searchWorkspace(query) { return searchWorkspace(query, db.roots().map((root) => root.path)); },
    modelFor(id) { return db.setting(`provider.model.${id}`, null); },
    // The single authoritative read for "what will handle the next message":
    // folds provider priority (registry), per-provider model choice, and
    // routing policy (orchestration settings) into one object. Also served
    // at GET /api/settings/effective, in addition to GET /api/providers.
    settings() {
      const p = registry.list();
      const active = p[0] || null;
      const orch = db.orchestrationSettings();
      return {
        activeProvider: active?.id || null,
        activeModel: this.modelFor(active?.id),
        cloudConfigured: registry.getByTags(['cloud']).length > 0,
        activeProviderLabel: active?.label || null,
        isCloudProvider: Boolean(active?.tags?.includes('cloud')),
        mode: orch.mode,
        autoEscalateRules: orch.autoEscalateRules,
      };
    },
    setModel(providerId, model) { const selected = this.getProvider(providerId); if (!model?.trim()) throw new ProviderError('Model is required.', 'model_required'); db.setSetting(`provider.model.${selected.id}`, model.trim()); },
    orchestrationSettings: () => db.orchestrationSettings(), updateOrchestrationSettings: (u) => db.updateOrchestrationSettings(u), async hardwareProfile() { return getHardwareProfile(registry.list()); }, async pingLocalEndpoint(endpoint) { return pingLocal(endpoint); },
    memories: (cat) => db.memories(cat), memory: (id) => db.memory(id), addMemory: (data) => db.addMemory(data), updateMemory: (id, u) => db.updateMemory(id, u), deleteMemory: (id) => db.deleteMemory(id), searchMemories: (q, cat) => db.searchMemories(q, cat), // "Auto-summarize" is the user-facing feature name (kept as-is — it does automatically
    // extract facts); extractMemoryFactsByRegex is the honest internal name for what
    // actually runs (see memory-engine.mjs).
    autoSummarizeMemory() { return extractMemoryFactsByRegex(db); },
    workspaceEdits: (status) => db.workspaceEdits(status), proposeWorkspaceEdit: (p, c, r) => db.proposeWorkspaceEdit(p, c, r),
    async approveWorkspaceEdit(id) { const edit = db.workspaceEdits().find((e) => e.id === id); if (!edit) throw new ProviderError('Edit not found.', 'not_found'); await writeWorkspaceFile(edit.file_path, edit.content, db.roots().map((root) => root.path)); return db.updateWorkspaceEditStatus(id, 'approved'); },
    rejectWorkspaceEdit(id) { return db.updateWorkspaceEditStatus(id, 'rejected'); },
  };
  return appObj;
}


