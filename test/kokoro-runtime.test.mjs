import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import { voiceModelManifest } from '../lib/model-bootstrap.mjs';
import { VoiceRuntime, localKokoroVoices } from '../lib/voice-runtime.mjs';
import { cleanVoiceTranscript } from '../lib/voice-transcript.mjs';

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

test('voice runtime initializes every model required by wake capture and playback', async () => {
  const installed = [];
  const runtime = new VoiceRuntime({ database: { setting: (_key, fallback) => fallback, setSetting: () => {} }, publish: () => {} });
  runtime.bootstrap = { install: async (id) => { installed.push(id); }, status: async () => installed.map((id) => ({ id, ready: true })) };
  await runtime.initialize();
  assert.deepEqual(installed, ['wake.hey-jarvis', 'stt.whisper-base-en', 'tts.kokoro-v1', 'vad.silero-v6']);
});

test('Silero VAD is a required voice-loop bootstrap model', () => {
  const vad = voiceModelManifest.find((item) => item.id === 'vad.silero-v6');
  assert.ok(vad);
  assert.equal(vad.optional, undefined);
  assert.deepEqual(vad.files.map(([file]) => file), ['model_quantized.onnx']);
});

test('voice runtime keeps daemon status available when model bootstrap fails', async () => {
  const events = [];
  const runtime = new VoiceRuntime({ database: { setting: (_key, fallback) => fallback, setSetting: () => {} }, publish: (event) => events.push(event) });
  runtime.bootstrap = { install: async (id) => { throw new Error(`offline ${id}`); }, status: async () => [{ id: 'wake.hey-jarvis', ready: false }] };
  await runtime.initialize();
  const status = await runtime.status();
  assert.equal(status.models[0].ready, false);
  assert.match(status.detail, /Unable to install vad\.silero-v6: offline vad\.silero-v6/);
  assert.equal(events.at(-1).state, 'bootstrap');
});

test('voice mode changes are persisted and published for the audio host', () => {
  const settings = new Map(); const events = [];
  const runtime = new VoiceRuntime({ database: { setting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback, setSetting: (key, value) => settings.set(key, value) }, publish: (event) => events.push(event) });
  runtime.setMode('wake');
  runtime.setMode('ptt');
  assert.equal(runtime.mode, 'ptt');
  assert.equal(settings.get('voice.mode'), 'ptt');
  assert.deepEqual(events.at(-1), { type: 'voice-state', state: 'bootstrap', mode: 'ptt', message: runtime.message('bootstrap') });
  assert.throws(() => runtime.setMode('always-on'), /Unsupported local voice mode/);
});

test('voice transcripts drop blank audio placeholders and wake prefixes', () => {
  const settings = new Map(); const events = [];
  const runtime = new VoiceRuntime({ database: { setting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback, setSetting: (key, value) => settings.set(key, value) }, publish: (event) => events.push(event) });
  assert.equal(cleanVoiceTranscript('[BLANK_AUDIO]'), null);
  assert.equal(cleanVoiceTranscript('(wooshing sound)'), null);
  assert.equal(cleanVoiceTranscript('(water splashing)'), null);
  assert.equal(cleanVoiceTranscript('[breathing]'), null);
  assert.equal(cleanVoiceTranscript('Hey Jarvis'), null);
  assert.equal(cleanVoiceTranscript('Jarvis'), null);
  assert.equal(cleanVoiceTranscript('Hey Jarvis, what is the capital of the United States?'), 'what is the capital of the United States?');
  assert.equal(runtime.transcript('final', '[BLANK_AUDIO]'), false);
  assert.equal(runtime.transcript('final', 'Jarvis: what is the capital of the United States?'), true);
  assert.equal(events.at(-1).text, 'what is the capital of the United States?');
  assert.equal(settings.get('voice.active-session').state, 'thinking');
});

const kokoroBundleInstalled = (await present(path.resolve('models/tts/kokoro-v1/kokoro-v1.0.onnx'))) && (await present(path.resolve('models/tts/kokoro-v1/voices-v1.0.bin')));
const kokoroWorkerSkip = !kokoroBundleInstalled ? 'Kokoro model bundle is not installed' : false;

test('Electron Kokoro worker uses the two-file bundle locally and produces 24 kHz audio', { skip: kokoroWorkerSkip }, async () => {
  const source = await fs.readFile(path.resolve('electron/kokoro-onnx-worker.mjs'), 'utf8');
  assert.doesNotMatch(source, /inflateRawSync|https?:\/\/|\bfetch\s*\(/);
  const root = process.cwd(); const worker = new Worker(path.resolve('electron/kokoro-onnx-worker.mjs'));
  try { const result = await finalWorkerMessage(worker, { id: 1, modelPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'kokoro-v1.0.onnx'), voicesPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'voices-v1.0.bin'), text: 'JARVIS is ready.', voice: 'bf_isabella' }); assert.equal(result.sampleRate, 24_000); assert.ok(result.samples.length > 0); } finally { await worker.terminate(); }
});
test('Electron Kokoro worker preloads the session without generating audio', { skip: kokoroWorkerSkip }, async () => {
  const root = process.cwd(); const worker = new Worker(path.resolve('electron/kokoro-onnx-worker.mjs'));
  try { const result = await finalWorkerMessage(worker, { id: 1, modelPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'kokoro-v1.0.onnx'), voicesPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'voices-v1.0.bin'), text: '', voice: 'bf_isabella' }); assert.equal(result.sampleRate, 24_000); assert.equal(result.samples.length, 0); } finally { await worker.terminate(); }
});
test('Electron Kokoro worker rejects voices that are not in the local bundle', { skip: kokoroWorkerSkip }, async () => {
  const worker = new Worker(path.resolve('electron/kokoro-onnx-worker.mjs'));
  try {
    const root = process.cwd();
    const result = await finalWorkerMessage(worker, { id: 1, modelPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'kokoro-v1.0.onnx'), voicesPath: path.join(root, 'models', 'tts', 'kokoro-v1', 'voices-v1.0.bin'), text: 'test', voice: 'zz_missing' });
    assert.equal(result.ok, false); assert.match(result.error, /missing from voices-v1\.0\.bin/);
  } finally { await worker.terminate(); }
});
async function present(file) { try { return (await fs.stat(file)).size > 0; } catch { return false; } }
function finalWorkerMessage(worker, payload) {
  return new Promise((resolve, reject) => {
    const progress = [];
    worker.once('error', reject);
    worker.on('message', (message) => {
      if (message.type === 'progress') { progress.push(message.stage); return; }
      if (message.ok) {
        assert.ok(progress.length, 'worker should report at least one TTS progress stage');
        resolve(message);
      } else {
        message.progress = progress;
        resolve(message);
      }
    });
    worker.postMessage(payload);
  });
}

