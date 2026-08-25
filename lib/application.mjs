import { JarvisDatabase } from './database.mjs'; import { diagnostics } from './diagnostics.mjs'; import { ProviderRegistry, ProviderError } from './providers/index.mjs'; import { canonicalRoot, readWorkspaceFile, writeWorkspaceFile, searchWorkspace, registeredTools } from './tools.mjs';
import { AssistantEventHub } from './event-hub.mjs'; import { VoiceRuntime } from './voice-runtime.mjs';
import { pingMcpServer as pingMcp, executeMcpTool as execTool, executeSkill as execSkill } from './mcp-skills.mjs';
import { parseSkillSource, fetchSkillMarkdown, parseSkillFrontmatter, buildImportedSkill, renderSkillAsMarkdown } from './skills-source.mjs';
import { listStdioTools } from './mcp-stdio.mjs';
import { getHardwareProfile, pingLocalEndpoint as pingLocal, evaluateTurnRouting, routeTurn } from './orchestrator.mjs';
import { extractMemoryFactsByRegex } from './memory-engine.mjs';
import { AgentRuntime } from './agents/runtime.mjs';
import { AVAILABLE_ADAPTERS, AVAILABLE_CLIS, AVAILABLE_CAPABILITIES, MAX_AGENT_NAME_LENGTH, MAX_AGENT_INSTRUCTIONS_LENGTH } from './agents/registry.mjs';
import { createReasoningSplitter } from './reasoning-stream.mjs';
import { buildCapabilityRegistry, capabilityNameForSkill, describeCapabilities, executeCapability } from './capabilities.mjs';
import { ACTIONS, AuthorizationError, EMPTY_AUTHORIZATION, GrantLedger, authorize, createTurnAuthorization, hasAnyGrant, hasGrant } from './authorization.mjs';

const MAX_TOOL_ROUNDS = 4;

export function createJarvisApp({ database, events = new AssistantEventHub() } = {}) {
  const db = database || new JarvisDatabase();
  const registry = new ProviderRegistry({ database: db }).reload();
  const active = new Map();
  const publish = (event) => events.publish(event);
  const voice = new VoiceRuntime({ database: db, publish });
  const agentRuntime = new AgentRuntime({ database: db, getProvider: (id) => appObj.getProvider(id), publish });
  const grants = new GrantLedger({ database: db });

  const appObj = {
    db, registry, events, voice, agentRuntime, grants,
    // The /api/providers health response consumes the flat .providers view.
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
    // Probe instances are transient and never touch the database.
    async probeProviderModels({ protocol, baseUrl, apiKey }) {
      if (!baseUrl?.trim()) throw new ProviderError('Base URL is required.', 'validation');
      const instance = ProviderRegistry.instanceFromConfig({ protocol, baseUrl, apiKey: apiKey || null });
      if (!instance) throw new ProviderError(`Unsupported protocol: ${protocol}`, 'unsupported_protocol');
      try {
        const models = await instance.listModels();
        return { available: true, models };
      } catch (error) {
        return { available: false, models: [], reason: error.message };
      }
    },

    // Approval is a daemon record for one exact operation. A client cannot mark its
    // own request approved; it asks for a grant, then submits the grant id.
    issueApproval({ action, target }) { return grants.issue({ action, target }); },
    authorizationFor(approvals = [], origin = null) {
      const consumed = (Array.isArray(approvals) ? approvals : [approvals]).filter(Boolean).map((id) => grants.consume(String(id)));
      return createTurnAuthorization({ grants: consumed, origin });
    },
    authorizationAudit: (limit) => db.authorizationAudit(limit),
    recordAuthorization: (entry) => grants.record(entry),
    // Slash invocation, the direct testers, and agent-bus invocation share this path.
    executeCapability(name, args = {}, { authorization = EMPTY_AUTHORIZATION, conversationId = null } = {}) {
      return executeCapability(appObj, name, args, { authorization, conversationId });
    },
    // The one provider call available to a skill body; the cloud decision is made here.
    async generate({ system, prompt, model, providerId, authorization = EMPTY_AUTHORIZATION }) {
      const provider = appObj.getProvider(providerId);
      if (provider.tags?.includes('cloud')) authorize(authorization, { action: ACTIONS.CLOUD, target: provider.id });
      const selectedModel = model || db.setting(`provider.model.${provider.id}`, null) || (await provider.listModels().catch(() => []))[0] || provider.model;
      if (!selectedModel) throw new ProviderError(`Select a model for ${provider.label}.`, 'model_required');
      const messages = system ? [{ role: 'system', content: system }, { role: 'user', content: prompt }] : [{ role: 'user', content: prompt }];
      let output = '';
      for await (const piece of provider.streamChat({ messages, model: selectedModel })) {
        if (typeof piece === 'string') output += piece;
        else if (piece?.type === 'token') output += piece.value;
      }
      return output;
    },
    conversations: () => db.conversations(), conversation: (id) => { const item = db.conversation(id); return item && { ...item, messages: db.messages(id) }; }, createConversation(title) { return db.createConversation(title); }, deleteConversation(id) { return db.deleteConversation(id); },
    agents: () => agentRuntime.listAgents(),
    agent: (id) => agentRuntime.getAgent(id),
    createAgent: (profile) => agentRuntime.createAgent(profile),
    updateAgent: (id, patch) => agentRuntime.updateAgent(id, patch),
    deleteAgent: (id) => agentRuntime.deleteAgent(id),
    // Editor options and registry validation share these constants.
    agentEditorOptions: () => ({
      adapters: AVAILABLE_ADAPTERS,
      clis: AVAILABLE_CLIS,
      capabilities: AVAILABLE_CAPABILITIES,
      maxNameLength: MAX_AGENT_NAME_LENGTH,
      maxInstructionsLength: MAX_AGENT_INSTRUCTIONS_LENGTH,
    }),
    executeAgentRun: ({ authorization = EMPTY_AUTHORIZATION, ...options } = {}) => agentRuntime.executeRun({ ...options, authorization }),
    agentRuns: (conversationId) => db.agentRuns(conversationId),
    // Agent-bus delegation is capped at depth two.
    agentBusTools: () => agentRuntime.busMcp.getTools(),
    executeAgentBusTool: (toolName, params, context = {}) => agentRuntime.busMcp.executeTool(toolName, params, { ...context, authorization: context.authorization || EMPTY_AUTHORIZATION }),

    mcpServers: () => db.mcpServers(), mcpServer: (id) => db.mcpServer(id),
    // SSE is rejected at registration; stdio tool declarations come from tools/list.
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
    async executeSkill(idOrCmd, input = '', { authorization = EMPTY_AUTHORIZATION } = {}) { const target = db.skill(idOrCmd) || db.skillByCommand(idOrCmd); if (!target) throw new ProviderError('Skill not found.', 'not_found'); return execSkill(target, input, appObj, { authorization }); },
    async importSkillFromSource(source) {
      const parsed = parseSkillSource(source);
      const { content, resolvedRef } = await fetchSkillMarkdown(parsed);
      const { frontmatter, body } = parseSkillFrontmatter(content);
      const built = buildImportedSkill({ ...parsed, resolvedRef }, frontmatter, body);
      return db.addSkill(built);
    },
    exportSkill(id) {
      const skill = db.skill(id);
      if (!skill) throw new ProviderError(`Skill "${id}" not found.`, 'not_found');
      return renderSkillAsMarkdown(skill);
    },

    async *chat({ conversationId, content, providerId, userOverrideProvider, model, authorization = EMPTY_AUTHORIZATION, signal, origin = 'desktop-text' }) {
      if (!content?.trim()) throw new ProviderError('Message is required.', 'validation');
      const text = content.trim();
      const conversation = conversationId ? db.conversation(conversationId) : db.createConversation(text.slice(0, 60));
      if (!conversation) throw new ProviderError('Conversation not found.', 'not_found');

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
            const skillResult = await appObj.executeCapability(capabilityNameForSkill(matchedSkill.slashCommand), { input: argInput }, { authorization, conversationId: conversation.id });
            if (controller.signal.aborted) throw new ProviderError('Request cancelled.', 'cancelled');
            if (skillResult && skillResult.success === false) throw new ProviderError(skillResult.error || skillResult.output || `Skill ${cmd} failed.`, 'skill_error');
            const outputText = skillResult.output || 'Skill executed successfully.';
            db.addMessage(conversation.id, 'assistant', outputText, 'skill', 'complete', origin);
            const tokenEvent = { type: 'token', value: outputText, conversationId: conversation.id, turnId };
            publish(tokenEvent); yield tokenEvent;
            const done = { type: 'turn-complete', conversationId: conversation.id, turnId }; publish(done); yield done; return;
          } catch (err) {
            const cancelled = controller.signal.aborted || err.code === 'cancelled';
            const errorText = cancelled ? 'Request cancelled.' : `Failed to execute skill ${cmd}: ${err.message}`;
            db.addMessage(conversation.id, 'assistant', errorText, 'skill', cancelled ? 'cancelled' : 'error', origin);
            const errEvent = { type: cancelled ? 'cancelled' : 'error', code: cancelled ? 'cancelled' : (err.code || 'skill_error'), conversationId: conversation.id, turnId, message: cancelled ? 'Request cancelled.' : err.message };
            publish(errEvent); yield errEvent; return;
          } finally { active.delete(conversation.id); }
        }
      }

      // Explicit IDs select exactly; absent IDs use tag-based routing.
      const orchSettings = db.orchestrationSettings();
      let selected;
      const cloudGranted = hasAnyGrant(authorization, ACTIONS.CLOUD);
      if (providerId || userOverrideProvider) {
        try { selected = appObj.getProvider(userOverrideProvider || providerId); } catch {}
      }
      if (!selected) {
        const { provider, reason, needsCloudApproval } = routeTurn(text, {
          mode: orchSettings.mode,
          userOverrideProvider: userOverrideProvider || null,
          allowCloud: cloudGranted,
          autoEscalateRules: orchSettings.autoEscalateRules,
        }, registry);
        if (!provider) {
          if (needsCloudApproval) throw new ProviderError('Cloud requests require explicit approval.', 'cloud_approval_required');
          throw new ProviderError(reason || 'No providers available. Add a provider in the Providers panel.', 'no_providers');
        }
        selected = provider;
      }
      // The decision is made before the request is built, for every origin alike.
      if (selected.tags?.includes('cloud')) {
        try {
          authorize(authorization, { action: ACTIONS.CLOUD, target: selected.id });
          grants.record({ context: authorization, action: ACTIONS.CLOUD, target: selected.id, granted: selected.id, effective: selected.id, outcome: 'allowed' });
        } catch (denial) {
          grants.record({ context: authorization, action: ACTIONS.CLOUD, target: selected.id, granted: null, effective: null, outcome: 'denied' });
          throw denial;
        }
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
      // Inline <think> content emits as request-local reasoning, outside persisted output.
      function* emitPieces(pieces) {
        for (const piece of pieces) {
          const event = { type: piece.type === 'reasoning' ? 'reasoning' : 'token', value: piece.text, conversationId: conversation.id, turnId };
          if (piece.type !== 'reasoning') output += piece.text;
          publish(event); yield event;
        }
      }
      // Providers without tool-calling support receive unmodified history because their
      // serializers do not accept this tool payload. Capability metadata is request-local.
      const capabilities = selected.supportsToolCalling ? buildCapabilityRegistry(appObj, { conversationId: conversation.id, authorization }) : [];
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
            if (tool.permission === 'approval-required' && !hasGrant(authorization, { action: ACTIONS.CAPABILITY_MUTATE, target: tool.name })) {
              grants.record({ context: authorization, action: ACTIONS.CAPABILITY_MUTATE, target: tool.name, granted: null, effective: null, outcome: 'denied' });
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
    tools: registeredTools, roots: () => db.roots(), async addRoot(rootPath) { return db.addRoot(await canonicalRoot(rootPath)); }, removeRoot(id) { return db.removeRoot(id); }, async readFile(filePath) { return readWorkspaceFile(filePath, db.roots().map((root) => root.path)); }, async writeFile(filePath, content) { return writeWorkspaceFile(filePath, content, db.roots().map((root) => root.path)); }, async searchWorkspace(query) { return searchWorkspace(query, db.roots().map((root) => root.path)); },
    modelFor(id) { return db.setting(`provider.model.${id}`, null); },
    // Effective settings combine provider priority, model choice, and routing policy.
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
    memories: (cat) => db.memories(cat), memory: (id) => db.memory(id), addMemory: (data) => db.addMemory(data), updateMemory: (id, u) => db.updateMemory(id, u), deleteMemory: (id) => db.deleteMemory(id), searchMemories: (q, cat) => db.searchMemories(q, cat),
    // The auto-summarize API extracts regex-matched facts without a provider call.
    autoSummarizeMemory() { return extractMemoryFactsByRegex(db); },
    workspaceEdits: (status) => db.workspaceEdits(status), proposeWorkspaceEdit: (p, c, r) => db.proposeWorkspaceEdit(p, c, r),
    async approveWorkspaceEdit(id) { const edit = db.workspaceEdits().find((e) => e.id === id); if (!edit) throw new ProviderError('Edit not found.', 'not_found'); await writeWorkspaceFile(edit.file_path, edit.content, db.roots().map((root) => root.path)); return db.updateWorkspaceEditStatus(id, 'approved'); },
    rejectWorkspaceEdit(id) { return db.updateWorkspaceEditStatus(id, 'rejected'); },
  };
  return appObj;
}


