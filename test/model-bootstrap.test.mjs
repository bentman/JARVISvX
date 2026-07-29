import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VoiceModelBootstrap } from '../lib/model-bootstrap.mjs';

test('voice assets are ready only when every required file is present and non-empty', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-'));
  const temporaryRoot = path.join(root, 'cache', 'temp');
  const model = { id: 'fixture', directory: 'wake/fixture', files: [['model.bin', 'https://example.test/model.bin']] };
  const bootstrap = new VoiceModelBootstrap({ root: path.join(root, 'models'), temporaryRoot, manifest: [model] });
  const modelRoot = path.join(bootstrap.root, model.directory);
  await fs.mkdir(modelRoot, { recursive: true });
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), '');
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, false);
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), 'model');
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, true);
  assert.equal(bootstrap.file(model.id, 'model.bin'), path.join(modelRoot, 'model.bin'));
  assert.equal(bootstrap.temporaryRoot, temporaryRoot);
  await fs.rm(root, { recursive: true, force: true });
});

test('bootstrap downloads only missing artifacts from their declared source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-'));
  const model = { id: 'fixture', directory: 'tts/fixture', files: [['model.onnx', 'https://example.test/model.onnx'], ['voices.bin', 'https://example.test/voices.bin']] };
  const bootstrap = new VoiceModelBootstrap({ root: path.join(root, 'models'), temporaryRoot: path.join(root, 'cache', 'temp'), manifest: [model] });
  const modelRoot = path.join(bootstrap.root, model.directory);
  await fs.mkdir(modelRoot, { recursive: true });
  await fs.writeFile(path.join(modelRoot, 'model.onnx'), 'present');
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); return new Response('voice-bundle'); };
  try {
    await bootstrap.install(model.id);
    assert.deepEqual(requests, ['https://example.test/voices.bin']);
    assert.equal(await fs.readFile(path.join(modelRoot, 'voices.bin'), 'utf8'), 'voice-bundle');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});
