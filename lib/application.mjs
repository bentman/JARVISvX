import { JarvisDatabase } from './database.mjs'; import { diagnostics } from './diagnostics.mjs'; import { LlamaCppProvider, OllamaProvider, OpenAICompatibleCloudProvider, ProviderError } from './providers.mjs'; import { canonicalRoot, readWorkspaceFile, writeWorkspaceFile, registeredTools } from './tools.mjs';
import { AssistantEventHub } from './event-hub.mjs'; import { VoiceRuntime } from './voice-runtime.mjs';
import { pingMcpServer as pingMcp, executeMcpTool as execTool, executeSkill as execSkill } from './mcp-skills.mjs';
import { getHardwareProfile, pingLocalEndpoint as pingLocal, evaluateTurnRouting } from './orchestrator.mjs';
import { autoSummarizeConversations } from './memory-engine.mjs';
import { AgentRuntime } from './agents/runtime.mjs';

export function createJarvisApp({ database, events = new AssistantEventHub() } = {}) {
  const db = database || new JarvisDatabase(); const providers = [new LlamaCppProvider(db.setting('provider.llamacpp', {})), new OllamaProvider(db.setting('provider.ollama', {})), new OpenAICompatibleCloudProvider(db.setting('provider.cloud', {}))]; const active = new Map(); const provider = (id) => providers.find((item) => item.id === id);
  const publish = (event) => events.publish(event); const voice = new VoiceRuntime({ database: db, publish });
  const agentRuntime = new AgentRuntime({ database: db, getProvider: (id) => appObj.getProvider(id), publish });
  const appObj = {
    db, providers, events, voice, agentRuntime,
    async initialize() { await voice.initialize(); await agentRuntime.initialize(db.roots().map((r) => r.path)); return this; },
    getProvider(id) { const selected = provider(id || db.setting('provider.active', 'llamacpp')); if (!selected) throw new ProviderError('Unknown provider.', 'unknown_provider'); return selected; },
    async health() { const info = await diagnostics(providers); return { status: 'ok', version: '0.1.0', loopbackOnly: true, providers: info.providers }; }, async diagnostics() { return diagnostics(providers); }, async models(providerId) { return this.getProvider(providerId).listModels(); },
    conversations: () => db.conversations(), conversation: (id) => { const item = db.conversation(id); return item && { ...item, messages: db.messages(id) }; }, createConversation(title) { return db.createConversation(title); }, deleteConversation(id) { return db.deleteConversation(id); },
    agents: () => agentRuntime.listAgents(),
    agent: (id) => agentRuntime.getAgent(id),
    executeAgentRun: (options) => agentRuntime.executeRun(options),
    agentRuns: (conversationId) => agentRuntime.listRuns(conversationId),
    workspaceEdits: (status) => db.workspaceEdits(status),
    proposeWorkspaceEdit: (filePath, content, reason) => db.proposeWorkspaceEdit(filePath, content, reason),
    async approveWorkspaceEdit(id) {
      const edit = db.db.prepare('SELECT * FROM workspace_edits WHERE id=?').get(id);
      if (!edit) throw new Error('Proposed edit not found.');
      const roots = db.roots().map((r) => r.path);
      await writeWorkspaceFile(edit.file_path, edit.content, roots);
      return db.updateWorkspaceEditStatus(id, 'approved_and_applied');
    },
    rejectWorkspaceEdit: (id) => db.updateWorkspaceEditStatus(id, 'rejected'),

    // Orchestration Methods
    orchestrationSettings: () => db.orchestrationSettings(),
    updateOrchestrationSettings: (updates) => db.updateOrchestrationSettings(updates),
    async pingLocalEndpoint(endpointUrl) { return pingLocal(endpointUrl || db.orchestrationSettings().localEndpoint); },
    async hardwareProfile() { return getHardwareProfile(providers); },

    // Memory Methods
    memories: (category) => db.memories(category),
    memory: (id) => db.memory(id),
    addMemory: (data) => db.addMemory(data),
    updateMemory: (id, updates) => db.updateMemory(id, updates),
    deleteMemory: (id) => db.deleteMemory(id),
    searchMemories: (query, category) => db.searchMemories(query, category),
    autoSummarizeMemory: () => autoSummarizeConversations(db),

    // MCP Methods
    mcpServers: () => db.mcpServers(),
    mcpServer: (id) => db.mcpServer(id),
    addMcpServer: (data) => db.addMcpServer(data),
    updateMcpServer: (id, updates) => db.updateMcpServer(id, updates),
    deleteMcpServer: (id) => db.deleteMcpServer(id),
    async pingMcpServer(id) {
      const server = db.mcpServer(id);
      if (!server) throw new ProviderError('MCP Server not found.', 'not_found');
      const res = await pingMcp(server);
      db.updateMcpServer(id, { status: res.status, latencyMs: res.latencyMs });
      return res;
    },
    async executeMcpTool(serverId, toolName, params) {
      const server = db.mcpServer(serverId);
      if (!server) throw new ProviderError('MCP Server not found.', 'not_found');
      return execTool(server, toolName, params, appObj);
    },

    // Skills Methods
    skills: () => db.skills(),
    skill: (id) => db.skill(id),
    addSkill: (data) => db.addSkill(data),
    updateSkill: (id, updates) => db.updateSkill(id, updates),
    deleteSkill: (id) => db.deleteSkill(id),
    toggleSkill: (id) => db.toggleSkill(id),
    async executeSkill(idOrCmd, input = '') {
      const target = db.skill(idOrCmd) || db.skillByCommand(idOrCmd);
      if (!target) throw new ProviderError('Skill not found.', 'not_found');
      return execSkill(target, input, appObj);
    },

    async *chat({ conversationId, content, providerId, model, allowCloud = false, signal, origin = 'desktop-text' }) {
      if (!content?.trim()) throw new ProviderError('Message is required.', 'validation');
      const text = content.trim();
      const conversation = conversationId ? db.conversation(conversationId) : db.createConversation(text.slice(0, 60));
      if (!conversation) throw new ProviderError('Conversation not found.', 'not_found');

      // Check if message is a Slash Skill Command (e.g., /calc 10+20 or /search react)
      if (text.startsWith('/')) {
        const parts = text.split(' ');
        const cmd = parts[0];
        const argInput = parts.slice(1).join(' ');
        const matchedSkill = db.skillByCommand(cmd);

        if (matchedSkill && matchedSkill.enabled) {
          if (active.has(conversation.id)) throw new ProviderError('This conversation already has an active turn.', 'turn_active');
          const turnId = crypto.randomUUID();
          db.addMessage(conversation.id, 'user', text, null, 'complete', origin);
          yield { type: 'start', conversationId: conversation.id, turnId, provider: 'skill', model: matchedSkill.slashCommand };
          publish({ type: 'session', state: 'turn-start', conversationId: conversation.id, turnId, origin });

          try {
            const skillResult = await execSkill(matchedSkill, argInput, appObj);
            const outputText = skillResult.output || 'Skill executed successfully.';
            db.addMessage(conversation.id, 'assistant', outputText, 'skill', 'complete', origin);
            yield { type: 'token', value: outputText, conversationId: conversation.id, turnId };
            const done = { type: 'turn-complete', conversationId: conversation.id, turnId };
            publish(done);
            yield done;
            return;
          } catch (err) {
            const errorText = `Failed to execute skill ${cmd}: ${err.message}`;
            db.addMessage(conversation.id, 'assistant', errorText, 'skill', 'error', origin);
            const errEvent = { type: 'error', code: 'skill_error', conversationId: conversation.id, turnId, message: err.message };
            publish(errEvent);
            yield errEvent;
            return;
          }
        }
      }

      const selected = this.getProvider(providerId); const selectedModel = model || this.modelFor(selected.id) || (await selected.listModels())[0]; if (!selectedModel) throw new ProviderError(`Select a model for ${selected.label}.`, 'model_required'); if (!this.modelFor(selected.id)) db.setSetting(`provider.model.${selected.id}`, selectedModel); if (selected.id === 'cloud' && !allowCloud) throw new ProviderError('Cloud requests require explicit approval.', 'cloud_approval_required');
      if (active.has(conversation.id)) throw new ProviderError('This conversation already has an active turn.', 'turn_active'); const controller = new AbortController(); const turnId = crypto.randomUUID(); active.set(conversation.id, { controller, turnId }); if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true }); db.addMessage(conversation.id, 'user', text, null, 'complete', origin); const history = db.messages(conversation.id).map((message) => ({ role: message.role, content: message.content })); let output = ''; yield { type: 'start', conversationId: conversation.id, turnId, provider: selected.id, model: selectedModel };
      publish({ type: 'session', state: 'turn-start', conversationId: conversation.id, turnId, origin });
      if (origin === 'voice') voice.setSession(conversation.id, 'thinking', turnId);
      try { for await (const token of selected.streamChat({ messages: history, model: selectedModel, signal: controller.signal })) { output += token; const event = { type: 'token', value: token, conversationId: conversation.id, turnId }; publish(event); yield event; } db.addMessage(conversation.id, 'assistant', output, selected.id, 'complete', origin); if (origin === 'voice') voice.setSession(conversation.id, 'speaking', turnId); const done = { type: 'turn-complete', conversationId: conversation.id, turnId }; publish(done); yield done; } catch (error) { const status = controller.signal.aborted ? 'cancelled' : 'error'; if (output) db.addMessage(conversation.id, 'assistant', output, selected.id, status, origin); if (origin === 'voice') voice.setSession(conversation.id, status === 'cancelled' ? 'wake-listening' : 'error', turnId); const event = { type: controller.signal.aborted ? 'cancelled' : 'error', code: error.code || status, conversationId: conversation.id, turnId, message: controller.signal.aborted ? 'Request cancelled.' : error.message }; publish(event); yield event; } finally { active.delete(conversation.id); }
    },
    cancel(conversationId, turnId = null) { const activeTurn = active.get(conversationId); if (!activeTurn || (turnId && activeTurn.turnId !== turnId)) return false; activeTurn.controller.abort(); voice.interrupt(conversationId); return true; }, tools: registeredTools, roots: () => db.roots(), async addRoot(rootPath) { return db.addRoot(await canonicalRoot(rootPath)); }, removeRoot(id) { return db.removeRoot(id); }, async readFile(filePath) { return readWorkspaceFile(filePath, db.roots().map((root) => root.path)); }, modelFor(id) { return db.setting(`provider.model.${id}`, null); }, settings() { const activeProvider = db.setting('provider.active', 'llamacpp'); return { activeProvider, activeModel: this.modelFor(activeProvider), cloudConfigured: provider('cloud').enabled }; }, setActiveProvider(id) { this.getProvider(id); db.setSetting('provider.active', id); }, setModel(providerId, model) { const selected = this.getProvider(providerId); if (!model?.trim()) throw new ProviderError('Model is required.', 'model_required'); db.setSetting(`provider.model.${selected.id}`, model.trim()); }
  };
  return appObj;
}


