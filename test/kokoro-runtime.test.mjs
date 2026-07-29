import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { voiceModelManifest } from '../lib/model-bootstrap.mjs';
import { VoiceRuntime, localKokoroVoices } from '../lib/voice-runtime.mjs';

test('Kokoro v1 uses its ONNX model and one shared voice bundle', () => {
  const model = voiceModelManifest.find((item) => item.id === 'tts.kokoro-v1');
  assert.ok(model);
  assert.deepEqual(model.files.map(([file]) => file), ['kokoro-v1.0.onnx', 'voices-v1.0.bin']);
  assert.equal(voiceModelManifest.some((item) => item.id === 'tts.kokoro-runtime'), false);
  assert.deepEqual(localKokoroVoices, ['af_bella', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis']);
});

test('Kokoro defaults to bf_isabella and accepts only the eight local voices', async () => {
  const settings = new Map();
  const runtime = new VoiceRuntime({ database: { setting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback, setSetting: (key, value) => settings.set(key, value) }, publish: () => {} });
  assert.equal((await runtime.status()).voice, 'bf_isabella');
  for (const voice of localKokoroVoices) runtime.setVoice(voice);
  assert.equal(settings.get('voice.kokoro.voice'), 'bm_lewis');
  assert.throws(() => runtime.setVoice('af_alloy'), /not installed locally/);
});

test('Electron Kokoro worker uses the two-file bundle locally and produces 24 kHz audio', { skip: !(await present(path.resolve('models/tts/kokoro-v1/kokoro-v1.0.onnx'))) || !(await present(path.resolve('models/tts/kokoro-v1/voices-v1.0.bin'))) && 'Kokoro model bundle is not installed' }, async () => {
  const source = await fs.readFile(path.resolve('electron/kokoro-onnx-worker.mjs'), 'utf8');
  assert.doesNotMatch(source, /inflateRawSync|https?:\/\/|\bfetch\s*\(/);
  const root = process.cwd(); const worker = new Worker(path.resolve('electron/kokoro-onnx-worker.mjs'));
  try { const result = await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', (message) => message.ok ? resolve(message) : reject(new Error(message.error))); worker.postMessage({ id: 1, modelPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'kokoro-v1.0.onnx'), voicesPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'voices-v1.0.bin'), text: 'JARVIS is ready.', voice: 'bf_isabella' }); }); assert.equal(result.sampleRate, 24_000); assert.ok(result.samples.length > 0); } finally { await worker.terminate(); }
});
test('Electron Kokoro worker rejects voices outside the local allowlist', async () => {
  const worker = new Worker(path.resolve('electron/kokoro-onnx-worker.mjs'));
  try {
    const result = await new Promise((resolve, reject) => { worker.once('error', reject); worker.once('message', resolve); worker.postMessage({ id: 1, modelPath: 'unused.onnx', voicesPath: 'unused.bin', text: 'test', voice: 'af_alloy' }); });
    assert.equal(result.ok, false); assert.match(result.error, /Unsupported local Kokoro voice/);
  } finally { await worker.terminate(); }
});
async function present(file) { try { return (await fs.stat(file)).size > 0; } catch { return false; } }
