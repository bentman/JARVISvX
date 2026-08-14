import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJarvisApp } from '../lib/application.mjs';
import { JarvisDatabase } from '../lib/database.mjs';

test('chat stream events are correlated by conversation and turn id', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  app.getProvider = () => ({
    id: 'fake',
    label: 'Fake provider',
    async listModels() { return ['fake-model']; },
    async *streamChat() { yield 'hello'; yield ' world'; }
  });

  try {
    const events = [];
    for await (const event of app.chat({ content: 'hi', providerId: 'fake', model: 'fake-model' })) events.push(event);
    assert.equal(events[0].type, 'start');
    assert.ok(events[0].conversationId);
    assert.ok(events[0].turnId);
    assert.deepEqual(events.map((event) => event.turnId), [events[0].turnId, events[0].turnId, events[0].turnId, events[0].turnId]);
    assert.deepEqual(events.map((event) => event.conversationId), [events[0].conversationId, events[0].conversationId, events[0].conversationId, events[0].conversationId]);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('slash skill stream events use the same conversation and turn id routing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  db.addSkill({
    name: 'Echo Skill',
    slashCommand: '/echo',
    description: 'Echoes skill input.',
    code: "return `skill says ${input}`;"
  });

  try {
    const events = [];
    for await (const event of app.chat({ content: '/echo hello', providerId: 'unused' })) events.push(event);
    assert.deepEqual(events.map((event) => event.type), ['start', 'token', 'turn-complete']);
    assert.ok(events[0].conversationId);
    assert.ok(events[0].turnId);
    assert.deepEqual(events.map((event) => event.turnId), [events[0].turnId, events[0].turnId, events[0].turnId]);
    assert.deepEqual(events.map((event) => event.conversationId), [events[0].conversationId, events[0].conversationId, events[0].conversationId]);
    assert.equal(events[1].value, 'skill says hello');
    assert.equal(app.cancel(events[0].conversationId, events[0].turnId), false);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cancel can target the active conversation and turn id', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  app.getProvider = () => ({
    id: 'fake',
    label: 'Fake provider',
    async listModels() { return ['fake-model']; },
    async *streamChat({ signal }) {
      yield 'partial';
      await new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      });
    }
  });

  try {
    const stream = app.chat({ content: 'hi', providerId: 'fake', model: 'fake-model' });
    const start = (await stream.next()).value;
    assert.equal(start.type, 'start');
    assert.equal((await stream.next()).value.type, 'token');
    assert.equal(app.cancel(start.conversationId, 'wrong-turn'), false);
    assert.equal(app.cancel(start.conversationId, start.turnId), true);
    const cancelled = (await stream.next()).value;
    assert.equal(cancelled.type, 'cancelled');
    assert.equal(cancelled.conversationId, start.conversationId);
    assert.equal(cancelled.turnId, start.turnId);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

