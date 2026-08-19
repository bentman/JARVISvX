import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { evaluateTurnRouting, getHardwareProfile, pingLocalEndpoint, routeTurn } from '../lib/orchestrator.mjs';

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

test('evaluateTurnRouting evaluates execution policies correctly', () => {
  const config = {
    mode: 'auto',
    autoEscalateRules: { maxCharCount: 20, requireSearch: true, requireCodeExecution: true }
  };

  // Short simple query -> Local
  const localRes = evaluateTurnRouting('hello world', config, true, true);
  assert.equal(localRes.shouldCloudEscalate, false);
  assert.equal(localRes.targetProvider, 'local');

  // Long prompt exceeding maxCharCount -> Cloud
  const longRes = evaluateTurnRouting('this is a very long prompt that exceeds twenty characters', config, true, true);
  assert.equal(longRes.shouldCloudEscalate, true);
  assert.equal(longRes.targetProvider, 'cloud');

  // Coding prompt -> Cloud
  const codeRes = evaluateTurnRouting('write a typescript function', config, true, true);
  assert.equal(codeRes.shouldCloudEscalate, true);

  // Local-only policy enforces local execution
  const localOnlyRes = evaluateTurnRouting('write a typescript function', { ...config, mode: 'local_only' }, true, true);
  assert.equal(localOnlyRes.shouldCloudEscalate, false);
  assert.equal(localOnlyRes.targetProvider, 'local');
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

test('routeTurn() branch behavior with a fake registry', () => {
  const provider = (id, tags, priority = 50) => ({ id, label: id, tags, priority });
  const makeRegistry = (providers) => ({
    get: (id) => providers.find((p) => p.id === id) || null,
    getByTags: (tags) => providers.filter((p) => tags.every((tag) => p.tags.includes(tag))).sort((a, b) => a.priority - b.priority),
    list: () => [...providers].sort((a, b) => a.priority - b.priority),
  });

  const local = provider('local-1', ['local'], 10);
  const cloud = provider('cloud-1', ['cloud'], 20);
  const registry = makeRegistry([local, cloud]);

  // 1. Explicit per-message override wins over everything else, including policy mode.
  const override = routeTurn('hi', { mode: 'cloud_only', userOverrideProvider: 'local-1', allowCloud: false }, registry);
  assert.equal(override.provider.id, 'local-1');

  // 3. Pinned provider via mode: 'provider:<id>'.
  const pinned = routeTurn('hi', { mode: 'provider:cloud-1', allowCloud: false }, registry);
  assert.equal(pinned.provider.id, 'cloud-1');

  // 4. local_only picks a local-tagged provider.
  const localOnly = routeTurn('hi', { mode: 'local_only' }, registry);
  assert.equal(localOnly.provider.id, 'local-1');

  // 4b. local_only with no local provider fails loudly — never substitutes cloud.
  const noLocalRegistry = makeRegistry([cloud]);
  const localOnlyNoLocal = routeTurn('hi', { mode: 'local_only' }, noLocalRegistry);
  assert.equal(localOnlyNoLocal.provider, null);
  assert.ok(!localOnlyNoLocal.needsCloudApproval, 'local_only failure is not a cloud-approval prompt');

  // 5. cloud_only without approval returns needsCloudApproval, no provider.
  const cloudOnlyDenied = routeTurn('hi', { mode: 'cloud_only', allowCloud: false }, registry);
  assert.equal(cloudOnlyDenied.provider, null);
  assert.equal(cloudOnlyDenied.needsCloudApproval, true);

  // 5b. cloud_only with approval picks the cloud-tagged provider.
  const cloudOnlyAllowed = routeTurn('hi', { mode: 'cloud_only', allowCloud: true }, registry);
  assert.equal(cloudOnlyAllowed.provider.id, 'cloud-1');

  // 6. auto mode escalates to cloud only when allowed AND a rule matches.
  const rules = { maxCharCount: 10, requireSearch: false, requireCodeExecution: false };
  const autoShort = routeTurn('hi', { mode: 'auto', allowCloud: true, autoEscalateRules: rules }, registry);
  assert.equal(autoShort.provider.id, 'local-1', 'short prompt stays local even when cloud is allowed');

  const autoLongNoApproval = routeTurn('this prompt is deliberately longer than the threshold', { mode: 'auto', allowCloud: false, autoEscalateRules: rules }, registry);
  assert.equal(autoLongNoApproval.provider.id, 'local-1', 'long prompt does not escalate without approval');

  const autoLongApproved = routeTurn('this prompt is deliberately longer than the threshold', { mode: 'auto', allowCloud: true, autoEscalateRules: rules }, registry);
  assert.equal(autoLongApproved.provider.id, 'cloud-1', 'long prompt escalates to cloud once approved');
});

