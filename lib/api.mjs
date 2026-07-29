import { Router } from 'express';

const sse = (res, event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

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
  if (token) router.use((req, res, next) => (req.get('x-jarvis-token') === token ? next() : res.status(401).json({ error: 'Daemon authentication required.', code: 'unauthorized' })));

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
  router.post('/chat', async (req, res) => { res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }); res.flushHeaders(); const controller = new AbortController(); req.on('aborted', () => controller.abort()); try { for await (const event of jarvis.chat({ ...req.body, signal: controller.signal })) sse(res, event); } catch (error) { sse(res, { type: 'error', code: error.code || 'error', message: error.message }); } finally { res.end(); } });
  router.post('/chat/:id/cancel', (req, res) => res.json({ cancelled: jarvis.cancel(req.params.id, req.body.turnId || null) }));
  router.get('/workspace-roots', (_req, res) => res.json(jarvis.roots()));
  router.post('/workspace-roots', async (req, res, next) => { try { res.status(201).json(await jarvis.addRoot(req.body.path)); } catch (error) { next(error); } });
  router.delete('/workspace-roots/:id', (req, res) => res.json({ removed: jarvis.removeRoot(req.params.id) }));
  router.post('/tools/read-file', async (req, res, next) => { try { res.json(await jarvis.readFile(req.body.path)); } catch (error) { next(error); } });
  router.post('/settings/active-provider', (req, res, next) => { try { jarvis.setActiveProvider(req.body.provider); res.status(204).end(); } catch (error) { next(error); } });
  router.post('/settings/model', (req, res, next) => { try { jarvis.setModel(req.body.provider, req.body.model); res.status(204).end(); } catch (error) { next(error); } });
  router.use((error, _req, res, _next) => res.status(error.code === 'not_found' ? 404 : 400).json({ error: error.message, code: error.code || 'error' }));
  return router;
}
