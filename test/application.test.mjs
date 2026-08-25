import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createJarvisApp } from '../lib/application.mjs';
import { JarvisDatabase } from '../lib/database.mjs';

// chat() resolves its provider through one selection operation; tests stub that.
const useProvider = (app, provider) => {
  app.getProvider = () => provider;
  app.selectProvider = () => ({ provider, source: 'user', reason: `Test provider ${provider.id}` });
};

test('chat stream events are correlated by conversation and turn id', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  useProvider(app, {
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
    // A user-authored skill is approval-required, by slash invocation as well.
    const denied = [];
    for await (const event of app.chat({ content: '/echo hello', providerId: 'unused' })) denied.push(event);
    assert.deepEqual(denied.map((event) => event.type), ['start', 'error']);
    assert.equal(denied[1].code, 'approval_required');

    const authorization = app.authorizationFor([app.issueApproval({ action: 'capability.mutate', target: 'echo' }).id]);
    const events = [];
    for await (const event of app.chat({ content: '/echo hello', conversationId: denied[0].conversationId, providerId: 'unused', authorization })) events.push(event);
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
  useProvider(app, {
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

test('<think> reasoning is streamed as its own event and excluded from the persisted message', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  useProvider(app, {
    id: 'fake',
    label: 'Fake provider',
    async listModels() { return ['fake-model']; },
    async *streamChat() {
      yield '<think>weighing options';
      yield '</think>The answer is 42.';
    }
  });

  try {
    const events = [];
    for await (const event of app.chat({ content: 'hi', providerId: 'fake', model: 'fake-model' })) events.push(event);
    const reasoningEvents = events.filter((event) => event.type === 'reasoning');
    const tokenEvents = events.filter((event) => event.type === 'token');
    assert.equal(reasoningEvents.map((event) => event.value).join(''), 'weighing options');
    assert.equal(tokenEvents.map((event) => event.value).join(''), 'The answer is 42.');
    assert.equal(events.at(-1).type, 'turn-complete');

    const conversationId = events[0].conversationId;
    const stored = db.messages(conversationId);
    const assistantMessage = stored.find((message) => message.role === 'assistant');
    assert.equal(assistantMessage.content, 'The answer is 42.');
    assert.ok(!assistantMessage.content.includes('weighing options'));
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('chat() auto-selects the lowest-priority-number provider when none is specified, unaffected by settings() changes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  // Priority 1 is deliberately lower than the DB's always-seeded default
  // llama.cpp entry (priority 10) so this provider wins outright.
  app.addProvider({ name: 'Secondary', protocol: 'openai-compat', base_url: 'http://127.0.0.1:1/v1', model: 'secondary-model', tags: ['local'], priority: 90 });
  const primary = app.addProvider({ name: 'Primary', protocol: 'openai-compat', base_url: 'http://127.0.0.1:1/v1', model: 'primary-model', tags: ['local'], priority: 1 });

  try {
    const events = [];
    for await (const event of app.chat({ content: 'hi', model: 'primary-model' })) events.push(event);
    assert.equal(events[0].type, 'start');
    assert.equal(events[0].provider, primary.id, 'the lower-priority-number provider should be selected by default');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an explicit provider id that does not resolve fails before the turn does any work', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  const conversation = db.createConversation('routing');

  try {
    await assert.rejects(async () => {
      for await (const event of app.chat({ conversationId: conversation.id, content: 'hi', providerId: 'not-a-provider' })) void event;
    }, (error) => error.code === 'unknown_provider');
    assert.deepEqual(db.messages(conversation.id), [], 'no message is written for a turn that never selected a provider');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the turn start event reports the provider actually used and why routing chose it', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });

  try {
    const local = app.addProvider({ name: 'Local', protocol: 'openai-compat', base_url: 'http://127.0.0.1:1/v1', model: 'local-model', tags: ['local'], priority: 1 });

    let start;
    for await (const event of app.chat({ content: 'hi' })) {
      if (event.type === 'start') { start = event; break; }
    }
    assert.equal(start.provider, local.id, 'the highest-priority eligible local provider is used');
    assert.equal(start.model, 'local-model');
    assert.equal(start.routing.source, 'auto-local');
    assert.match(start.routing.reason, /local/i);
    assert.equal(app.settings().activeProvider, start.provider, 'settings report the same effective selection');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a chat turn carries bounded, ordered memory in the canonical system instruction', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-mem-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });

  try {
    for (const row of db.memories()) db.deleteMemory(row.id);
    db.addMemory({ category: 'code_context', key: 'stack', value: 'Node and SQLite', importance: 'high' });
    db.addMemory({ category: 'user_preference', key: 'tone', value: 'terse', importance: 'low' });

    let captured;
    useProvider(app, {
      id: 'fake', label: 'Fake provider',
      async listModels() { return ['fake-model']; },
      async *streamChat(request) { captured = request; yield 'ok'; },
    });

    for await (const event of app.chat({ content: 'hi', providerId: 'fake', model: 'fake-model' })) void event;

    assert.ok(captured.system.includes('=== MEMORY CONTEXT ==='), 'the memory section is delimited');
    assert.ok(captured.system.indexOf('stack') < captured.system.indexOf('tone'), 'high importance comes first');
    assert.ok(!captured.messages.some((message) => message.role === 'system'), 'the instruction stays out of conversation messages');
    assert.equal(captured.messages.at(-1).content, 'hi');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('model precedence prefers the request, then the saved setting, then the configured default, then discovery', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-model-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });

  try {
    const provider = { id: 'p1', label: 'P1', model: 'configured-model', async listModels() { return ['discovered-model']; } };

    assert.equal(await app.resolveModel({ provider, requested: 'requested-model' }), 'requested-model');
    assert.equal(await app.resolveModel({ provider, requested: '  ' }), 'configured-model', 'an empty request is ignored');

    db.setSetting('provider.model.p1', 'saved-model');
    assert.equal(await app.resolveModel({ provider }), 'saved-model');
    assert.equal(await app.resolveModel({ provider, requested: 'requested-model' }), 'requested-model');

    // Discovery is advisory: it never displaces a configured model or gets saved.
    assert.equal(await app.resolveModel({ provider: { ...provider, model: 'configured-model' } }), 'saved-model');
    const discoveryOnly = { id: 'p2', label: 'P2', model: '', async listModels() { return ['discovered-model']; } };
    assert.equal(await app.resolveModel({ provider: discoveryOnly }), 'discovered-model');
    assert.equal(db.setting('provider.model.p2', null), null, 'resolving does not save a model');

    await assert.rejects(
      app.resolveModel({ provider: { id: 'p3', label: 'P3', model: '', async listModels() { return []; } } }),
      (error) => error.code === 'model_required'
    );
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a disabled provider id is reported as disabled, not unknown', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-disabled-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  const conversation = db.createConversation('identity');

  try {
    const disabled = app.addProvider({ name: 'Off', protocol: 'openai-compat', base_url: 'http://127.0.0.1:1/v1', model: 'm', enabled: false });
    assert.throws(() => app.getProvider(disabled.id), (error) => error.code === 'provider_disabled');
    assert.throws(() => app.getProvider('never-existed'), (error) => error.code === 'unknown_provider');

    await assert.rejects(async () => {
      for await (const event of app.chat({ conversationId: conversation.id, content: 'hi', providerId: disabled.id })) void event;
    }, (error) => error.code === 'provider_disabled');
    assert.deepEqual(db.messages(conversation.id), [], 'no turn work happens for an unusable id');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
