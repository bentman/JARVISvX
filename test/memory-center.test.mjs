import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { autoSummarizeConversations, formatMemoriesContext } from '../lib/memory-engine.mjs';

test('database seeds default long-term memories', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-db-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const items = db.memories();
  assert.ok(items.length >= 4, 'Should seed at least 4 default memory items');
  const userPref = items.find((m) => m.category === 'user_preference');
  assert.ok(userPref, 'User preference memory should exist');
  assert.ok(userPref.key.includes('Execution Preference'));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('memory CRUD and category filter operations work cleanly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-crud-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const newMem = db.addMemory({
    category: 'code_context',
    key: 'Preferred Language',
    value: 'Always use strict TypeScript with ES modules.',
    importance: 'high'
  });

  assert.ok(newMem.id, 'New memory should have ID');
  assert.equal(newMem.key, 'Preferred Language');
  assert.equal(newMem.importance, 'high');

  const filtered = db.memories('code_context');
  assert.ok(filtered.some((m) => m.id === newMem.id));

  const updated = db.updateMemory(newMem.id, { value: 'TypeScript ESNext modules' });
  assert.equal(updated.value, 'TypeScript ESNext modules');

  const deleted = db.deleteMemory(newMem.id);
  assert.equal(deleted, true);
  assert.equal(db.memory(newMem.id), null);

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('searchMemories performs keyword search over memory keys and values', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-search-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  db.addMemory({
    category: 'system_fact',
    key: 'Database Engine',
    value: 'Local SQLite database via node:sqlite DatabaseSync.',
    importance: 'medium'
  });

  const searchResults = db.searchMemories('DatabaseSync');
  assert.ok(searchResults.length >= 1, 'Should find memory containing DatabaseSync');
  assert.equal(searchResults[0].key, 'Database Engine');

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('autoSummarizeConversations extracts long-term memories from conversation turns', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-sum-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const conv = db.createConversation('Preference test');
  db.addMessage(conv.id, 'user', 'I always prefer dark mode themes for my project interfaces.');

  const result = autoSummarizeConversations(db);
  assert.ok(result.addedCount >= 1, 'Should auto-extract user preference memory');

  const memories = db.memories('conversation_summary');
  assert.ok(memories.some((m) => m.value.includes('dark mode themes')));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('app initialization exposes memory methods and formats context', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-app-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();

  const items = app.memories();
  assert.ok(items.length >= 4);

  const ctx = formatMemoriesContext(db);
  assert.ok(ctx.includes('LONG-TERM MEMORY CONTEXT:'));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
