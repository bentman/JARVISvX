import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { voiceModelManifest } from '../lib/model-bootstrap.mjs';

function nextEvent(hub) {
  let unsubscribe = () => {};
  return new Promise((resolve) => {
    unsubscribe = hub.subscribe((event) => { unsubscribe(); resolve(event); });
  });
}

async function readSseEvent(reader) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error('Event stream ended before an event was received.');
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n'); buffer = frames.pop() || '';
    for (const frame of frames) {
      const data = frame.split('\n').find((line) => line.startsWith('data:'));
      if (data) return JSON.parse(data.slice(5));
    }
  }
}

test('daemon owns an authenticated loopback API and shares assistant events', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-daemon-'));
  process.env.JARVIS_DATA_DIR = directory;
  process.env.JARVIS_MODEL_DIR = path.join(directory, 'models');
  for (const model of voiceModelManifest) {
    for (const [file] of model.files) {
      const target = path.join(process.env.JARVIS_MODEL_DIR, model.directory, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file === 'voices-v1.0.bin' ? 'fixture-voices' : 'fixture-model');
    }
  }
  const { startDaemon } = await import('../lib/daemon.mjs');
  const daemon = await startDaemon({ port: 0, token: 'test-token' });
  try {
    const denied = await fetch(`http://127.0.0.1:${daemon.port}/api/health`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`http://127.0.0.1:${daemon.port}/api/health`, { headers: { 'x-jarvis-token': 'test-token' } });
    assert.equal(allowed.status, 200);
    const asset = await fetch(`http://127.0.0.1:${daemon.port}/api/voice-assets/wake.hey-jarvis/hey_jarvis_v0.1.onnx`);
    assert.equal(await asset.text(), 'fixture-model');
    const received = nextEvent(daemon.jarvis.events);
    daemon.jarvis.events.publish({ type: 'voice-state', state: 'muted' });
    assert.equal((await received).type, 'voice-state');
    const transcriptEvent = nextEvent(daemon.jarvis.events);
    const transcript = await fetch(`http://127.0.0.1:${daemon.port}/api/voice/transcript`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-token': 'test-token' }, body: JSON.stringify({ kind: 'final', text: 'turn on the lights' }) });
    assert.deepEqual(await transcript.json(), { accepted: true });
    assert.equal((await transcriptEvent).type, 'final-transcript');
    const activeVoiceSession = daemon.jarvis.db.setting('voice.active-session');
    assert.equal(activeVoiceSession.conversationId, null);
    assert.equal(activeVoiceSession.state, 'thinking');
    assert.ok(activeVoiceSession.lastTranscriptAt);
    daemon.jarvis.voice.setSession('shared-voice-session', 'speaking');
    assert.equal(daemon.jarvis.db.setting('voice.active-session').conversationId, 'shared-voice-session');
    assert.equal(daemon.jarvis.db.setting('voice.active-session').state, 'speaking');
    const muteEvent = nextEvent(daemon.jarvis.events);
    daemon.jarvis.voice.setEnabled(false);
    const muted = await muteEvent;
    assert.equal(muted.type, 'voice-state');
    assert.equal(muted.state, 'muted');
    assert.equal(muted.enabled, false);
    const voice = await fetch(`http://127.0.0.1:${daemon.port}/api/voice/voice`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-token': 'test-token' }, body: JSON.stringify({ voice: 'not-a-local-voice' }) });
    assert.equal(voice.status, 400);
    assert.equal((await fetch(`http://127.0.0.1:${daemon.port}/api/voice`, { headers: { 'x-jarvis-token': 'test-token' } })).status, 200);
    const streamAbort = new AbortController();
    const stream = await fetch(`http://127.0.0.1:${daemon.port}/api/events`, { headers: { 'x-jarvis-token': 'test-token' }, signal: streamAbort.signal });
    assert.equal(stream.status, 200);
    const reader = stream.body.getReader();
    try {
      const eventNext = readSseEvent(reader);
      await new Promise((resolve) => setTimeout(resolve, 10));
      daemon.jarvis.voice.event({ type: 'playback', state: 'started' });
      assert.equal((await eventNext).type, 'playback');
    } finally {
      streamAbort.abort();
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    // Provider IDs are opaque; protocol identifies the seeded Ollama provider.
    const ollamaProvider = daemon.jarvis.listProviders().find((p) => p.protocol === 'ollama');
    assert.ok(ollamaProvider, 'an Ollama-protocol provider should be seeded by default');
    const model = await fetch(`http://127.0.0.1:${daemon.port}/api/settings/model`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-token': 'test-token' }, body: JSON.stringify({ provider: ollamaProvider.id, model: 'qwen3:8b' }) });
    assert.equal(model.status, 204);
    assert.equal(daemon.jarvis.modelFor(ollamaProvider.id), 'qwen3:8b');
  } finally {
    await daemon.close();
    await fs.rm(directory, { recursive: true, force: true });
    delete process.env.JARVIS_DATA_DIR;
    delete process.env.JARVIS_MODEL_DIR;
  }
});
