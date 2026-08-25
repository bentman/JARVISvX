import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { getHardwareProfile, pingLocalEndpoint, routeTurn } from '../lib/orchestrator.mjs';

test('database persists and updates orchestration settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-orch-db-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const initial = db.orchestrationSettings();
  assert.equal(initial.mode, 'auto');
  assert.equal(initial.autoEscalateRules.maxCharCount, 400);

  const updated = db.updateOrchestrationSettings({
    mode: 'local_only',
    localEndpoint: 'http://127.0.0.1:8080/v1',
    autoEscalateRules: { maxCharCount: 800, requireSearch: false, requireCodeExecution: true }
  });

  assert.equal(updated.mode, 'local_only');
  assert.equal(updated.localEndpoint, 'http://127.0.0.1:8080/v1');
  assert.equal(updated.autoEscalateRules.maxCharCount, 800);

  db.close();
  const reopened = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  assert.equal(reopened.orchestrationSettings().mode, 'local_only');
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('getHardwareProfile detects system CPU cores and computes model recommendation', async () => {
  const profile = await getHardwareProfile([]);
  assert.ok(profile.cpuCores >= 1, 'CPU cores should be at least 1');
  assert.ok(profile.ramGB >= 1, 'RAM should be at least 1 GB');
  assert.ok(profile.recommendedLocalModel.length > 0, 'Recommended model should be computed');
});

test('pingLocalEndpoint detects OpenAI-compatible and Ollama model endpoints', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      return res.end(JSON.stringify({ data: [{ id: 'openai-compatible-model' }] }));
    }
    if (req.url === '/api/tags') {
      return res.end(JSON.stringify({ models: [{ name: 'ollama-model' }] }));
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const openAi = await pingLocalEndpoint(`http://127.0.0.1:${port}/v1`);
  assert.deepEqual(openAi.models, ['openai-compatible-model']);

  const ollama = await pingLocalEndpoint(`http://127.0.0.1:${port}`);
  assert.deepEqual(ollama.models, ['openai-compatible-model']);

  const ollamaTags = await pingLocalEndpoint(`http://127.0.0.1:${port}/api/tags`);
  assert.deepEqual(ollamaTags.models, ['ollama-model']);
});

test('app initialization exposes orchestration methods', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-orch-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();

  const settings = app.orchestrationSettings();
  assert.ok(settings.mode, 'Mode should exist');

  const updated = app.updateOrchestrationSettings({ mode: 'cloud_only' });
  assert.equal(updated.mode, 'cloud_only');

  const profile = await app.hardwareProfile();
  assert.ok(profile.ramGB >= 1);

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('app.settings() folds provider priority, model, and orchestration mode into one object', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-effective-settings-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });

  // Two providers at different priorities — the lower number wins. Priority 1
  // is deliberately lower than the DB's always-seeded default llama.cpp entry
  // (priority 10) so this provider wins outright rather than tying with it.
  app.addProvider({ name: 'Cloud Backup', protocol: 'openai-compat', base_url: 'http://example.invalid/v1', tags: ['cloud'], priority: 90 });
  const primary = app.addProvider({ name: 'Local Primary', protocol: 'openai-compat', base_url: 'http://127.0.0.1:8080/v1', tags: ['local'], priority: 1 });
  app.setModel(primary.id, 'llama-test-model');
  app.updateOrchestrationSettings({ mode: 'local_only', autoEscalateRules: { maxCharCount: 123, requireSearch: false, requireCodeExecution: true } });

  const settings = app.settings();
  assert.equal(settings.activeProvider, primary.id, 'lowest-priority-number provider should be active');
  assert.equal(settings.activeProviderLabel, 'Local Primary');
  assert.equal(settings.activeModel, 'llama-test-model');
  assert.equal(settings.isCloudProvider, false);
  assert.equal(settings.cloudConfigured, true, 'a cloud-tagged provider exists even though it is not active');
  assert.equal(settings.mode, 'local_only');
  assert.deepEqual(settings.autoEscalateRules, { maxCharCount: 123, requireSearch: false, requireCodeExecution: true });

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('orchestration mode round-trips through settings() after an update', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mode-roundtrip-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });

  assert.equal(app.settings().mode, 'auto', 'default mode before any update');
  app.updateOrchestrationSettings({ mode: 'local_only' });
  assert.equal(app.settings().mode, 'local_only');

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('routeTurn() resolves precedence without falling through', () => {
  const provider = (id, tags, priority = 50) => ({ id, label: id, tags, priority });
  const local = provider('local-1', ['local'], 10);
  const cloud = provider('cloud-1', ['cloud'], 20);
  const makeRegistry = (providers, disabled = []) => ({
    get: (id) => providers.find((p) => p.id === id) || null,
    getByTags: (tags) => providers.filter((p) => tags.every((tag) => p.tags.includes(tag))).sort((a, b) => a.priority - b.priority),
    list: () => [...providers].sort((a, b) => a.priority - b.priority),
    status: (id) => (providers.some((p) => p.id === id) ? 'enabled' : disabled.includes(id) ? 'disabled' : 'unknown'),
  });
  const registry = makeRegistry([local, cloud], ['disabled-1']);

  // Precedence: user, then agent pin, then mode pin.
  assert.equal(routeTurn('hi', { mode: 'cloud_only', userOverrideProvider: 'local-1', allowCloud: false }, registry).provider.id, 'local-1');
  assert.equal(routeTurn('hi', { mode: 'cloud_only', agentProviderOverride: 'local-1', allowCloud: false }, registry).provider.id, 'local-1');
  assert.equal(routeTurn('hi', { mode: 'provider:cloud-1', allowCloud: false }, registry).provider.id, 'cloud-1');
  assert.equal(routeTurn('hi', { mode: 'provider:local-1', userOverrideProvider: 'cloud-1' }, registry).source, 'user', 'a user id outranks the mode pin');
  assert.equal(routeTurn('hi', { mode: 'provider:local-1', agentProviderOverride: 'cloud-1' }, registry).provider.id, 'cloud-1', 'an agent pin outranks the mode pin');

  // A supplied id that does not resolve refuses; it never drops to a lower source.
  for (const context of [{ userOverrideProvider: 'nope' }, { agentProviderOverride: 'nope' }, { mode: 'provider:nope' }]) {
    const refused = routeTurn('hi', { mode: 'auto', ...context }, registry);
    assert.equal(refused.provider, null);
    assert.equal(refused.code, 'unknown_provider');
  }
  assert.equal(routeTurn('hi', { userOverrideProvider: 'disabled-1' }, registry).code, 'provider_disabled');

  // Policy modes never cross a tag boundary to produce an answer.
  assert.equal(routeTurn('hi', { mode: 'local_only' }, registry).provider.id, 'local-1');
  const noLocal = routeTurn('hi', { mode: 'local_only' }, makeRegistry([cloud]));
  assert.equal(noLocal.code, 'no_eligible_provider');
  assert.equal(noLocal.mode, 'local_only');

  assert.equal(routeTurn('hi', { mode: 'cloud_only', allowCloud: false }, registry).code, 'cloud_approval_required');
  assert.equal(routeTurn('hi', { mode: 'cloud_only', allowCloud: true }, registry).provider.id, 'cloud-1');
  assert.equal(routeTurn('hi', { mode: 'cloud_only', allowCloud: true }, makeRegistry([local])).code, 'no_eligible_provider');

  // Auto escalates only when a rule matches and the grant is present.
  const rules = { maxCharCount: 10, requireSearch: false, requireCodeExecution: false };
  const long = 'this prompt is deliberately longer than the threshold';
  assert.equal(routeTurn('hi', { mode: 'auto', allowCloud: true, autoEscalateRules: rules }, registry).source, 'auto-local');
  assert.equal(routeTurn(long, { mode: 'auto', allowCloud: false, autoEscalateRules: rules }, registry).provider.id, 'local-1');
  assert.equal(routeTurn(long, { mode: 'auto', allowCloud: true, autoEscalateRules: rules }, registry).source, 'auto-escalated');

  // Auto with no local provider needs the grant before the cloud one is eligible.
  const cloudOnlyRegistry = makeRegistry([cloud]);
  assert.equal(routeTurn('hi', { mode: 'auto' }, cloudOnlyRegistry).code, 'cloud_approval_required');
  assert.equal(routeTurn('hi', { mode: 'auto', allowCloud: true }, cloudOnlyRegistry).provider.id, 'cloud-1');
  assert.equal(routeTurn('hi', { mode: 'auto' }, makeRegistry([])).code, 'no_eligible_provider');
});
