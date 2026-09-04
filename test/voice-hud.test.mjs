import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { VoiceRuntime } from '../lib/voice-runtime.mjs';

test('voice runtime status returns installed Kokoro voices and mode settings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vhud-db-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const events = [];
  const voice = new VoiceRuntime({ database: db, publish: (e) => events.push(e) });

  const status = await voice.status();
  assert.equal(status.enabled, true);
  assert.equal(status.voice, 'bf_isabella');
  assert.ok(status.voices.includes('af_sarah'));
  assert.ok(status.voices.includes('am_adam'));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('voice runtime supports mode changes and persona selections with event publishing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vhud-mode-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const events = [];
  const voice = new VoiceRuntime({ database: db, publish: (e) => events.push(e) });

  voice.setMode('ptt');
  assert.equal(voice.mode, 'ptt');

  voice.setVoice('af_sarah');
  assert.equal(db.setting('voice.kokoro.voice', null), 'af_sarah');

  voice.setState('capturing', 'Listening for speech');
  assert.equal(voice.state, 'capturing');

  assert.ok(events.some((e) => e.type === 'voice-state' && e.mode === 'ptt'), 'Should publish mode change event');
  assert.ok(events.some((e) => e.type === 'voice-state' && e.voice === 'af_sarah'), 'Should publish voice change event');

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('voice runtime handles partial and final speech transcripts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vhud-trans-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const events = [];
  const voice = new VoiceRuntime({ database: db, publish: (e) => events.push(e) });

  const okPartial = voice.transcript('partial', 'Hey Jarvis what is the weather');
  assert.equal(okPartial, true);

  const okFinal = voice.transcript('final', 'Hey Jarvis what is the weather today');
  assert.equal(okFinal, true);

  assert.ok(events.some((e) => e.type === 'partial-transcript' && e.text.includes('what is the weather')));
  assert.ok(events.some((e) => e.type === 'final-transcript' && e.text.includes('what is the weather today')));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});


test('the interaction mode is durable and a recorded transient state is not reported as live', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-vhud-durable-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');

  const first = new JarvisDatabase(dbPath);
  const before = new VoiceRuntime({ database: first, publish: () => {} });
  before.setMode('conversation');
  // Diagnostic history from the previous process, including a state that only
  // makes sense while that process was running.
  before.setState('capturing', 'Mid-utterance when the process ended.');
  first.close();

  const second = new JarvisDatabase(dbPath);
  const after = new VoiceRuntime({ database: second, publish: () => {} });
  const status = await after.status();

  assert.equal(status.mode, 'conversation', 'the selected mode survives a restart');
  assert.notEqual(status.state, 'capturing', 'a transient state is not restored as the live one');

  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
