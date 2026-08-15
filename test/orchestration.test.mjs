import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { evaluateTurnRouting, getHardwareProfile, pingLocalEndpoint } from '../lib/orchestrator.mjs';

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

