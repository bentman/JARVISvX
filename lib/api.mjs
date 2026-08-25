import { Router } from 'express';
import { capabilityNameForSkill } from './capabilities.mjs';
import { dataDirectoryInfo } from './data-migration.mjs';


const sse = (res, event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

const STATUS_FOR_CODE = { not_found: 404, approval_required: 403, policy_denied: 403, cloud_approval_required: 403, unsupported_policy: 403 };

export function createApiRouter(jarvis, { token } = {}) {
  const router = Router();
  router.get('/voice-assets/:model/*splat', (req, res) => {
    const tail = Array.isArray(req.params.splat) ? req.params.splat.join('/') : String(req.params.splat || '');
    const file = jarvis.voice.bootstrap.file(req.params.model, tail);
    if (!file) return res.status(404).json({ error: `Voice asset is not declared: ${req.params.model}/${tail}` });
    res.sendFile(file, (error) => {
      if (error && !res.headersSent) res.status(error.statusCode || 404).json({ error: `Voice asset is missing or unreadable: ${req.params.model}/${tail}` });
    });
  });

  router.get('/session', (req, res) => res.json({ token, port: req.socket?.localPort || 3210, status: 'authenticated' }));

  if (token) router.use((req, res, next) => (req.get('x-jarvis-token') === token ? next() : res.status(401).json({ error: 'Daemon authentication required.', code: 'unauthorized' })));

  // A client asks the daemon for an approval and submits the grant id with its
  // request. A request boolean never authorizes work on its own.
  router.post('/approvals', (req, res, next) => { try { res.status(201).json(jarvis.issueApproval({ action: req.body.action, target: req.body.target })); } catch (error) { next(error); } });

  router.get('/health', async (_req, res, next) => { try { res.json(await jarvis.health()); } catch (error) { next(error); } });
  router.get('/diagnostics', async (_req, res, next) => { try { res.json(await jarvis.diagnostics()); } catch (error) { next(error); } });
  router.get('/voice', async (_req, res, next) => { try { res.json(await jarvis.voice.status()); } catch (error) { next(error); } });
  router.post('/voice/bootstrap/:id', async (req, res, next) => { try { res.json(await jarvis.voice.install(req.params.id)); } catch (error) { next(error); } });
  router.post('/voice/enabled', (req, res) => { jarvis.voice.setEnabled(req.body.enabled); res.status(204).end(); });
  router.post('/voice/mode', (req, res, next) => { try { jarvis.voice.setMode(req.body.mode); res.status(204).end(); } catch (error) { next(error); } });
  router.post('/voice/voice', (req, res, next) => { try { jarvis.voice.setVoice(req.body.voice); res.status(204).end(); } catch (error) { next(error); } });
  router.post('/voice/state', (req, res) => { jarvis.voice.setState(req.body.state, req.body.detail); res.status(204).end(); });
  router.post('/voice/transcript', (req, res) => res.json({ accepted: jarvis.voice.transcript(req.body.kind, req.body.text, req.body.conversationId || null) }));
  router.post('/voice/event', (req, res) => res.json({ accepted: jarvis.voice.event(req.body) }));
  router.get('/events', (req, res) => { res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.flushHeaders(); const unsubscribe = jarvis.events.subscribe((event) => sse(res, event)); req.on('close', unsubscribe); });
  router.get('/providers', async (_req, res, next) => { try { res.json({ settings: jarvis.settings(), providers: await Promise.all(jarvis.providers.map((provider) => provider.health())) }); } catch (error) { next(error); } });
  router.get('/models', async (req, res, next) => { try { res.json({ provider: req.query.provider, models: await jarvis.models(req.query.provider) }); } catch (error) { next(error); } });
  router.get('/conversations', (_req, res) => res.json(jarvis.conversations()));
  router.post('/conversations', (req, res) => res.status(201).json(jarvis.createConversation(req.body.title)));
  router.get('/conversations/:id', (req, res) => { const item = jarvis.conversation(req.params.id); if (!item) return res.status(404).json({ error: 'Conversation not found.' }); res.json(item); });
  router.delete('/conversations/:id', (req, res) => res.json({ removed: jarvis.deleteConversation(req.params.id) }));
  
  router.get('/agents', (_req, res) => res.json(jarvis.agents()));
  // Static agent routes must precede the /agents/:id catch-all.
  router.get('/agents/editor-options', (_req, res) => res.json(jarvis.agentEditorOptions()));
  router.post('/agents', async (req, res, next) => { try { res.status(201).json(await jarvis.createAgent(req.body)); } catch (error) { next(error); } });
  router.get('/agents/:id', (req, res) => { const item = jarvis.agent(req.params.id); if (!item) return res.status(404).json({ error: 'Agent profile not found.' }); res.json(item); });
  router.put('/agents/:id', async (req, res, next) => { try { res.json(await jarvis.updateAgent(req.params.id, req.body)); } catch (error) { next(error); } });
  router.delete('/agents/:id', async (req, res, next) => { try { res.json(await jarvis.deleteAgent(req.params.id)); } catch (error) { next(error); } });
  router.post('/agents/run', async (req, res, next) => { try { const { approvals, ...options } = req.body; res.json(await jarvis.executeAgentRun({ ...options, authorization: jarvis.authorizationFor(approvals, 'api') })); } catch (error) { next(error); } });
  router.get('/runs', (req, res) => res.json(jarvis.agentRuns(req.query.conversationId || null)));
  router.get('/agent-bus/tools', (_req, res) => res.json({ tools: jarvis.agentBusTools() }));
  router.post('/agent-bus/tools/:toolName/execute', async (req, res, next) => { try { const { approvals, ...params } = req.body; res.json(await jarvis.executeCapability(req.params.toolName, params, { authorization: jarvis.authorizationFor(approvals, 'api') })); } catch (error) { next(error); } });
  router.post('/chat', async (req, res, next) => {
    const { approvals, ...body } = req.body;
    let authorization;
    // Grants are consumed before the stream opens, so a denial is an ordinary
    // response rather than an error event on a half-written stream.
    try { authorization = jarvis.authorizationFor(approvals, body.origin || 'api'); } catch (error) { return next(error); }
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.flushHeaders();
    const controller = new AbortController(); req.on('aborted', () => controller.abort());
    try { for await (const event of jarvis.chat({ ...body, authorization, signal: controller.signal })) sse(res, event); }
    catch (error) { sse(res, { type: 'error', code: error.code || 'error', message: error.message }); }
    finally { res.end(); }
  });
  router.post('/chat/:id/cancel', (req, res) => res.json({ cancelled: jarvis.cancel(req.params.id, req.body.turnId || null) }));
  router.get('/workspace-roots', (_req, res) => res.json(jarvis.roots()));
  router.post('/workspace-roots', async (req, res, next) => { try { res.status(201).json(await jarvis.addRoot(req.body.path)); } catch (error) { next(error); } });
  router.delete('/workspace-roots/:id', (req, res) => res.json({ removed: jarvis.removeRoot(req.params.id) }));
  router.get('/data-directory', (_req, res) => res.json(dataDirectoryInfo(jarvis.paths.dataRoot)));

  // Registry CRUD uses /provider-registry; /providers owns the bootstrap health shape.
  router.get('/provider-registry', (_req, res) => res.json(jarvis.listProviders()));
  router.post('/provider-registry', (req, res, next) => { try { res.status(201).json(jarvis.addProvider(req.body)); } catch (error) { next(error); } });
  router.post('/provider-registry/probe', async (req, res, next) => { try { res.json(await jarvis.probeProviderModels(req.body)); } catch (error) { next(error); } });
  router.get('/provider-registry/:id', (req, res, next) => { try { const p = jarvis.getProviderRecord(req.params.id); if (!p) return res.status(404).json({ error: 'Provider not found', code: 'not_found' }); res.json(p); } catch (error) { next(error); } });
  router.put('/provider-registry/:id', (req, res, next) => { try { const p = jarvis.updateProvider(req.params.id, req.body); if (!p) return res.status(404).json({ error: 'Provider not found', code: 'not_found' }); res.json(p); } catch (error) { next(error); } });
  router.delete('/provider-registry/:id', (req, res) => res.json({ removed: jarvis.deleteProvider(req.params.id) }));
  router.post('/provider-registry/:id/test', async (req, res, next) => { try { res.json(await jarvis.testProvider(req.params.id)); } catch (error) { next(error); } });
  router.post('/provider-registry/:id/toggle', (req, res, next) => { try { const p = jarvis.toggleProvider(req.params.id); if (!p) return res.status(404).json({ error: 'Provider not found', code: 'not_found' }); res.json(p); } catch (error) { next(error); } });

  router.get('/workspace-edits', (req, res) => res.json(jarvis.workspaceEdits(req.query.status)));
  router.post('/workspace-edits/propose', (req, res, next) => { try { res.status(201).json(jarvis.proposeWorkspaceEdit(req.body.path, req.body.content, req.body.reason)); } catch (error) { next(error); } });
  router.post('/workspace-edits/:id/approve', async (req, res, next) => { try { res.json(await jarvis.approveWorkspaceEdit(req.params.id)); } catch (error) { next(error); } });
  router.post('/workspace-edits/:id/reject', (req, res, next) => { try { res.json(jarvis.rejectWorkspaceEdit(req.params.id)); } catch (error) { next(error); } });
  // Model Orchestration Endpoints
  router.get('/orchestration', async (_req, res, next) => { try { res.json({ settings: jarvis.orchestrationSettings(), hardware: await jarvis.hardwareProfile() }); } catch (error) { next(error); } });
  router.post('/orchestration', (req, res, next) => { try { res.json(jarvis.updateOrchestrationSettings(req.body)); } catch (error) { next(error); } });
  router.post('/orchestration/ping-endpoint', async (req, res, next) => { try { res.json(await jarvis.pingLocalEndpoint(req.body.endpoint)); } catch (error) { next(error); } });
  router.get('/orchestration/hardware', async (_req, res, next) => { try { res.json(await jarvis.hardwareProfile()); } catch (error) { next(error); } });

  // Memory Center Endpoints
  router.get('/memory', (req, res) => res.json(jarvis.memories(req.query.category)));
  router.post('/memory', (req, res, next) => { try { res.status(201).json(jarvis.addMemory(req.body)); } catch (error) { next(error); } });
  router.put('/memory/:id', (req, res, next) => { try { res.json(jarvis.updateMemory(req.params.id, req.body)); } catch (error) { next(error); } });
  router.delete('/memory/:id', (req, res) => res.json({ removed: jarvis.deleteMemory(req.params.id) }));
  router.post('/memory/search', (req, res) => res.json(jarvis.searchMemories(req.body.query, req.body.category)));
  router.post('/memory/auto-summarize', (req, res) => res.json(jarvis.autoSummarizeMemory()));

  // MCP Servers Endpoints
  router.get('/mcp', (_req, res) => res.json({ servers: jarvis.mcpServers() }));
  router.post('/mcp', async (req, res, next) => { try { res.status(201).json(await jarvis.addMcpServer(req.body)); } catch (error) { next(error); } });
  router.post('/mcp/:id/ping', async (req, res, next) => { try { res.json(await jarvis.pingMcpServer(req.params.id)); } catch (error) { next(error); } });
  // The direct tester reaches the same capability record and policy check as model
  // and slash invocation.
  router.post('/mcp/:id/tools/:toolName/execute', async (req, res, next) => {
    try {
      const server = jarvis.mcpServer(req.params.id);
      if (!server) return res.status(404).json({ error: 'MCP Server not found.', code: 'not_found' });
      if (!(server.tools || []).some((tool) => tool.name === req.params.toolName)) return res.status(404).json({ error: `Server "${server.name}" does not declare a "${req.params.toolName}" tool.`, code: 'not_found' });
      const { approvals, ...params } = req.body;
      res.json(await jarvis.executeCapability(req.params.toolName, params, { authorization: jarvis.authorizationFor(approvals, 'api') }));
    } catch (error) { next(error); }
  });
  router.delete('/mcp/:id', (req, res) => res.json({ removed: jarvis.deleteMcpServer(req.params.id) }));

  // Slash Skills Endpoints
  router.get('/skills', (_req, res) => res.json(jarvis.skills()));
  router.post('/skills', (req, res, next) => { try { res.status(201).json(jarvis.addSkill(req.body)); } catch (error) { next(error); } });
  router.post('/skills/import', async (req, res, next) => { try { res.status(201).json(await jarvis.importSkillFromSource(req.body.source)); } catch (error) { next(error); } });
  router.put('/skills/:id', (req, res, next) => { try { res.json(jarvis.updateSkill(req.params.id, req.body)); } catch (error) { next(error); } });
  router.delete('/skills/:id', (req, res) => res.json({ removed: jarvis.deleteSkill(req.params.id) }));
  router.post('/skills/:id/toggle', (req, res, next) => { try { res.json(jarvis.toggleSkill(req.params.id)); } catch (error) { next(error); } });
  router.get('/skills/:id/export', (req, res, next) => { try { res.json(jarvis.exportSkill(req.params.id)); } catch (error) { next(error); } });
  router.post('/skills/execute', async (req, res, next) => {
    try {
      const skill = jarvis.skill(req.body.id) || jarvis.skills().find((item) => item.slashCommand.toLowerCase() === String(req.body.command || '').trim().toLowerCase());
      if (!skill) return res.status(404).json({ error: 'Skill not found.', code: 'not_found' });
      res.json(await jarvis.executeCapability(capabilityNameForSkill(skill.slashCommand), { input: req.body.input || '' }, { authorization: jarvis.authorizationFor(req.body.approvals, 'api') }));
    } catch (error) { next(error); }
  });

  router.post('/settings/model', (req, res, next) => { try { jarvis.setModel(req.body.provider, req.body.model); res.status(204).end(); } catch (error) { next(error); } });
  router.get('/settings/effective', (_req, res) => res.json(jarvis.settings()));
  router.use((error, _req, res, _next) => res.status(STATUS_FOR_CODE[error.code] || 400).json({ error: error.message, code: error.code || 'error' }));
  return router;
}
