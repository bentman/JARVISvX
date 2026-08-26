import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

// Fixture artifacts stand in for the real models. Their digests are computed
// from the fixture content so bootstrap validates them exactly as it would a
// real download, without reaching the network.
function fixtureManifest() {
  return voiceModelManifest.map((model) => ({
    ...model,
    files: model.files.map(([file]) => {
      const content = file === 'voices-v1.0.bin' ? 'fixture-voices' : 'fixture-model';
      return [file, `https://example.invalid/${file}`, Buffer.byteLength(content), createHash('sha256').update(content).digest('hex')];
    }),
  }));
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
  const daemon = await startDaemon({ port: 0, token: 'test-token', voiceManifest: fixtureManifest() });
  // Voice acquisition runs alongside startup, so let it settle before asserting
  // on the event stream it also publishes to.
  await daemon.voiceReady;
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

test('resource routes report the right status, and the session bootstrap is loopback and origin bound', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-routes-'));
  process.env.JARVIS_DATA_DIR = directory;
  const { startDaemon } = await import('../lib/daemon.mjs');
  const daemon = await startDaemon({ port: 0, token: 'route-test-token', voiceManifest: fixtureManifest() });
  const base = `http://127.0.0.1:${daemon.port}`;
  const call = (route, options = {}) => fetch(base + route, { ...options, headers: { 'content-type': 'application/json', 'x-jarvis-token': 'route-test-token', ...options.headers } });

  try {
    // An unknown id is 404 with the common error shape, not 200 saying nothing happened.
    for (const route of ['/api/memory/nope', '/api/skills/nope', '/api/mcp/nope', '/api/conversations/nope', '/api/provider-registry/nope', '/api/workspace-roots/nope']) {
      const response = await call(route, { method: 'DELETE' });
      assert.equal(response.status, 404, `${route} should be 404`);
      assert.equal((await response.json()).code, 'not_found', `${route} should carry the common error shape`);
    }

    // An illegal state transition is a conflict.
    const edit = await (await call('/api/workspace-edits/propose', { method: 'POST', body: JSON.stringify({ path: path.join(directory, 'x.txt'), content: 'c', reason: 'r' }) })).json();
    assert.equal((await call(`/api/workspace-edits/${edit.id}/reject`, { method: 'POST', body: '{}' })).status, 200);
    const repeat = await call(`/api/workspace-edits/${edit.id}/reject`, { method: 'POST', body: '{}' });
    assert.equal(repeat.status, 409);
    assert.equal((await repeat.json()).code, 'conflict');
    assert.equal((await call('/api/workspace-edits/nope/approve', { method: 'POST', body: '{}' })).status, 404);

    // Invalid data stays 400.
    assert.equal((await call('/api/memory', { method: 'POST', body: JSON.stringify({ key: 'k', value: 'v', importance: 'CRITICAL' }) })).status, 400);

    const session = await fetch(`${base}/api/session`);
    assert.equal(session.status, 200);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const foreign = await fetch(`${base}/api/session`, { headers: { origin: 'http://evil.example' } });
    assert.equal(foreign.status, 403, 'a foreign origin cannot read the token');
  } finally {
    await daemon.close();
    await fs.rm(directory, { recursive: true, force: true });
    delete process.env.JARVIS_DATA_DIR;
  }
});

test('electron navigation carries no daemon token', async () => {
  const main = await fs.readFile(new URL('../electron/main.mjs', import.meta.url), 'utf8');
  const navigation = main.match(/loadURL\(([^\n]+)\)/)[1];
  assert.ok(!/token/i.test(navigation), `navigation URL must not carry the token: ${navigation}`);
  assert.ok(main.includes("ipcMain.handle('jarvis:daemon'"), 'the token reaches the renderer over the existing bridge');

  const client = await fs.readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
  assert.ok(!client.includes("params.get('daemon')"), 'the renderer does not parse token state out of the URL');
});

// --- Single-instance ownership ---

async function withDataRoot(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-lock-'));
  const previous = process.env.JARVIS_DATA_DIR;
  process.env.JARVIS_DATA_DIR = directory;
  const { createRuntimePaths } = await import('../lib/runtime-paths.mjs');
  try {
    await fn({ directory, paths: createRuntimePaths() });
  } finally {
    if (previous === undefined) delete process.env.JARVIS_DATA_DIR; else process.env.JARVIS_DATA_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test('two contenders for one data root produce exactly one owner', async () => {
  await withDataRoot(async ({ paths }) => {
    const { startDaemon } = await import('../lib/daemon.mjs');
    const first = await startDaemon({ port: 0, token: 'owner-token', paths });
    try {
      await assert.rejects(startDaemon({ port: 0, token: 'contender-token', paths }), /already running/);

      // The lock names its owner before anyone can read it.
      const record = JSON.parse(await fs.readFile(paths.lockPath, 'utf8'));
      assert.equal(record.pid, process.pid);
      assert.ok(record.instance, 'the lock carries an instance identity');
      assert.ok(record.createdAt, 'and when it was taken');

      // Every lifecycle state answers the ownership probe as that instance.
      const status = await fetch(`http://127.0.0.1:${first.port}/daemon/status`, { headers: { 'x-jarvis-token': 'owner-token' } });
      const body = await status.json();
      assert.equal(body.pid, record.pid);
      assert.equal(body.instance, record.instance);
      assert.ok(['starting', 'ready', 'degraded', 'stopping'].includes(body.status));
      assert.equal((await fetch(`http://127.0.0.1:${first.port}/daemon/status`)).status, 401, 'the probe is authenticated');
    } finally {
      await first.close();
    }
    assert.equal(await fs.access(paths.lockPath).then(() => true, () => false), false, 'shutdown releases the lock');
  });
});

test('a lock is released only on evidence its owner is gone', async () => {
  await withDataRoot(async ({ paths }) => {
    const { startDaemon } = await import('../lib/daemon.mjs');

    // A live process holds its lock even with no discovery to corroborate it:
    // missing discovery is an absence of evidence, not proof of staleness.
    await fs.writeFile(paths.lockPath, JSON.stringify({ pid: process.pid, instance: 'someone-else', createdAt: 'n' }));
    await assert.rejects(startDaemon({ port: 0, token: 't', paths }), /already running/);

    // An unreadable lock record cannot prove its owner is gone either.
    await fs.writeFile(paths.lockPath, '{ half-writ');
    await assert.rejects(startDaemon({ port: 0, token: 't', paths }), /already running/);

    // A recorded process that is absent, with nothing answering as it, is stale.
    await fs.writeFile(paths.lockPath, JSON.stringify({ pid: 0x7fffffff, instance: 'dead', createdAt: 'n' }));
    const daemon = await startDaemon({ port: 0, token: 't', paths });
    try {
      assert.equal(JSON.parse(await fs.readFile(paths.lockPath, 'utf8')).pid, process.pid, 'the stale lock was taken over');
    } finally {
      await daemon.close();
    }
  });
});

test('a failed startup leaves no lock behind', async () => {
  await withDataRoot(async ({ paths }) => {
    const { startDaemon } = await import('../lib/daemon.mjs');
    // An unusable port fails after the lock is taken.
    await assert.rejects(startDaemon({ port: -1, token: 't', paths }));
    assert.equal(await fs.access(paths.lockPath).then(() => true, () => false), false, 'the lock is released when startup unwinds');
  });
});
