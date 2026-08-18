import { JarvisDatabase } from './database.mjs'; import { diagnostics } from './diagnostics.mjs'; import { ProviderRegistry, ProviderError } from './providers/index.mjs'; import { canonicalRoot, readWorkspaceFile, writeWorkspaceFile, registeredTools } from './tools.mjs';
import { AssistantEventHub } from './event-hub.mjs'; import { VoiceRuntime } from './voice-runtime.mjs';
import { pingMcpServer as pingMcp, executeMcpTool as execTool, executeSkill as execSkill } from './mcp-skills.mjs';
import { getHardwareProfile, pingLocalEndpoint as pingLocal, evaluateTurnRouting, routeTurn } from './orchestrator.mjs';
import { autoSummarizeConversations } from './memory-engine.mjs';
import { AgentRuntime } from './agents/runtime.mjs';

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

    mcpServers: () => db.mcpServers(), mcpServer: (id) => db.mcpServer(id), addMcpServer: (data) => db.addMcpServer(data), deleteMcpServer: (id) => db.deleteMcpServer(id), async pingMcpServer(id) { const server = db.mcpServer(id); if (!server) throw new ProviderError('MCP Server not found.', 'not_found'); return pingMcp(server); },
    async executeMcpTool(serverId, toolName, params) { const server = db.mcpServer(serverId); if (!server) throw new ProviderError('MCP Server not found.', 'not_found'); return execTool(server, toolName, params, appObj); },
    skills: () => db.skills(), skill: (id) => db.skill(id), addSkill: (data) => db.addSkill(data), updateSkill: (id, updates) => db.updateSkill(id, updates), deleteSkill: (id) => db.deleteSkill(id), toggleSkill: (id) => db.toggleSkill(id),
    async executeSkill(idOrCmd, input = '') { const target = db.skill(idOrCmd) || db.skillByCommand(idOrCmd); if (!target) throw new ProviderError('Skill not found.', 'not_found'); return execSkill(target, input, appObj); },

    async *chat({ conversationId, content, providerId, userOverrideProvider, model, allowCloud = false, signal, origin = 'desktop-text' }) {
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
      try {
        for await (const token of selected.streamChat({ messages: history, model: selectedModel, signal: controller.signal })) {
          output += token; const event = { type: 'token', value: token, conversationId: conversation.id, turnId }; publish(event); yield event;
        }
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
    tools: registeredTools, roots: () => db.roots(), async addRoot(rootPath) { return db.addRoot(await canonicalRoot(rootPath)); }, removeRoot(id) { return db.removeRoot(id); }, async readFile(filePath) { return readWorkspaceFile(filePath, db.roots().map((root) => root.path)); },
    modelFor(id) { return db.setting(`provider.model.${id}`, null); },
    settings() { const p = registry.list(); return { activeProvider: p[0]?.id || null, activeModel: this.modelFor(p[0]?.id), cloudConfigured: registry.getByTags(['cloud']).length > 0 }; },
    setActiveProvider(id) { this.getProvider(id); db.setSetting('provider.active', id); },
    setModel(providerId, model) { const selected = this.getProvider(providerId); if (!model?.trim()) throw new ProviderError('Model is required.', 'model_required'); db.setSetting(`provider.model.${selected.id}`, model.trim()); },
    orchestrationSettings: () => db.orchestrationSettings(), updateOrchestrationSettings: (u) => db.updateOrchestrationSettings(u), async hardwareProfile() { return getHardwareProfile(registry.list()); }, async pingLocalEndpoint(endpoint) { return pingLocal(endpoint); },
    memories: (cat) => db.memories(cat), memory: (id) => db.memory(id), addMemory: (data) => db.addMemory(data), updateMemory: (id, u) => db.updateMemory(id, u), deleteMemory: (id) => db.deleteMemory(id), searchMemories: (q, cat) => db.searchMemories(q, cat), autoSummarizeMemory() { return autoSummarizeConversations(db, this); },
    workspaceEdits: (status) => db.workspaceEdits(status), proposeWorkspaceEdit: (p, c, r) => db.proposeWorkspaceEdit(p, c, r),
    async approveWorkspaceEdit(id) { const edit = db.workspaceEdits().find((e) => e.id === id); if (!edit) throw new ProviderError('Edit not found.', 'not_found'); await writeWorkspaceFile(edit.file_path, edit.content, db.roots().map((root) => root.path)); return db.updateWorkspaceEditStatus(id, 'approved'); },
    rejectWorkspaceEdit(id) { return db.updateWorkspaceEditStatus(id, 'rejected'); },
  };
  return appObj;
}


