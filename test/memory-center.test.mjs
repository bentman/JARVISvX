import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { extractMemoryFactsByRegex, selectMemories } from '../lib/memory-engine.mjs';

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

test('extractMemoryFactsByRegex extracts long-term memories from conversation turns', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-sum-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const conv = db.createConversation('Preference test');
  db.addMessage(conv.id, 'user', 'I always prefer dark mode themes for my project interfaces.');

  const result = extractMemoryFactsByRegex(db);
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

  const selection = selectMemories(db);
  assert.equal(selection.selected.length, items.length);
  assert.ok(selection.text.includes(items[0].key));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});


test('memory selection is ordered by importance, then recency, then id, and bounded by its budget', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-select-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  try {
    for (const row of db.memories()) db.deleteMemory(row.id);
    const rows = [
      { id: 'm-low', importance: 'low', updated_at: '2026-01-09' },
      { id: 'm-med-b', importance: 'medium', updated_at: '2026-01-02' },
      { id: 'm-high', importance: 'high', updated_at: '2026-01-01' },
      { id: 'm-med-a', importance: 'medium', updated_at: '2026-01-02' },
    ];
    const insert = db.db.prepare('INSERT INTO memories(id,category,key,value,importance,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    for (const row of rows) insert.run(row.id, 'code_context', row.id, 'value', row.importance, row.updated_at, row.updated_at);

    // High first; the two mediums share a timestamp so the id breaks the tie; low last.
    assert.deepEqual(selectMemories(db).selected, ['m-high', 'm-med-a', 'm-med-b', 'm-low']);

    const bounded = selectMemories(db, { budget: 80 });
    assert.ok(bounded.used <= 80);
    assert.ok(bounded.selected.length > 0 && bounded.excluded.length > 0, 'the budget admits some records and excludes others');
    assert.deepEqual([...bounded.selected, ...bounded.excluded].sort(), rows.map((r) => r.id).sort(), 'every record is either selected or excluded');
    for (const id of bounded.excluded) assert.ok(!bounded.text.includes(id), 'an excluded record does not reach the section');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('memory importance is constrained on write', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-importance-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  try {
    const before = db.memories().length;
    assert.throws(() => db.addMemory({ key: 'k', value: 'v', importance: 'CRITICAL' }), (error) => error.code === 'validation');
    assert.equal(db.memories().length, before, 'a rejected write leaves stored records unchanged');

    const created = db.addMemory({ key: 'k', value: 'v', importance: 'high' });
    assert.throws(() => db.updateMemory(created.id, { importance: '' }), (error) => error.code === 'validation');
    assert.equal(db.memory(created.id).importance, 'high');
    assert.equal(db.updateMemory(created.id, { importance: 'low' }).importance, 'low');
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an unconstrained importance column migrates every unrecognized value to medium', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mem-migrate-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');

  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE memories (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT ('user_preference'), key TEXT NOT NULL, value TEXT NOT NULL, importance TEXT NOT NULL DEFAULT ('medium'), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  const insert = legacy.prepare('INSERT INTO memories VALUES(?,?,?,?,?,?,?)');
  for (const [id, importance] of [['keep-high', 'high'], ['keep-low', ' low '], ['blank', ''], ['unrecognized', 'CRITICAL']]) {
    insert.run(id, 'code_context', id, 'value', importance, 'n', 'n');
  }
  legacy.close();

  try {
    const db = new JarvisDatabase(dbPath);
    const importanceById = Object.fromEntries(db.memories().map((row) => [row.id, row.importance]));
    assert.equal(importanceById['keep-high'], 'high');
    assert.equal(importanceById['keep-low'], 'low', 'a padded valid value is preserved');
    assert.equal(importanceById['blank'], 'medium');
    assert.equal(importanceById['unrecognized'], 'medium');
    db.close();

    // Re-running converges rather than rebuilding again.
    const reopened = new JarvisDatabase(dbPath);
    assert.equal(reopened.memories().filter((row) => row.id in importanceById).length, 4);
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the stale seeded stack fact is corrected in place, and an operator-edited row is left alone', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-stack-fact-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');
  const stale = 'Built with React 19, Tailwind CSS, Lucide icons, and Canvas particle effects.';

  const before = new JarvisDatabase(dbPath);
  // Stand in for a database seeded before the correction.
  before.db.prepare('UPDATE memories SET value=? WHERE id=?').run(stale, 'mem-3');
  before.db.prepare('UPDATE memories SET value=? WHERE id=?').run('My own note about the frontend.', 'mem-1');
  before.close();

  const after = new JarvisDatabase(dbPath);
  const stack = after.db.prepare('SELECT value FROM memories WHERE id=?').get('mem-3').value;
  assert.notEqual(stack, stale, 'the stale row is replaced');
  assert.ok(!/Tailwind|Canvas/.test(stack), 'and no longer names a stack this project does not have');
  assert.equal(after.db.prepare('SELECT value FROM memories WHERE id=?').get('mem-1').value, 'My own note about the frontend.', 'an operator-edited row is untouched');
  after.close();

  fs.rmSync(directory, { recursive: true, force: true });
});
