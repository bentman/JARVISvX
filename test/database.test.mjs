import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { JarvisDatabase, PROJECT_ROOT } from '../lib/database.mjs';
import { MCP_HEALTH_STATES, WORKSPACE_EDIT_STATES } from '../lib/contracts.mjs';

test('database persists settings, conversations, and messages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-db-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  db.setSetting('provider.active', 'ollama');
  const conversation = db.createConversation('A real conversation');
  db.addMessage(conversation.id, 'user', 'Hello');
  assert.equal(db.setting('provider.active'), 'ollama');
  assert.equal(db.messages(conversation.id)[0].content, 'Hello');
  db.close();
  const reopened = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  assert.equal(reopened.conversation(conversation.id).title, 'A real conversation');
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});


test('provider credentials round-trip against key material that belongs to the database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-db-key-'));
  const originalSalt = process.env.JARVIS_KEY_SALT;
  const details = { name: 'Cloud', protocol: 'openai-compat', base_url: 'https://example.invalid/v1' };
  delete process.env.JARVIS_KEY_SALT;
  try {
    const dataRoot = path.join(directory, 'data');
    // The installation's own key material legitimately exists on any machine
    // that has run the application, so absence is not the thing to assert. What
    // must hold is that a database at its own root leaves that file untouched.
    const installedKey = path.join(PROJECT_ROOT, 'data', 'provider.key');
    const installedKeyBefore = fs.existsSync(installedKey) ? fs.statSync(installedKey).mtimeMs : null;
    const db = new JarvisDatabase({ dataRoot });
    const created = db.addProvider({ ...details, api_key: 'file-backed-secret' });

    assert.equal(db.providerApiKey(created.id), 'file-backed-secret');
    assert.ok(fs.existsSync(path.join(dataRoot, 'provider.key')), 'key material belongs beside its database');
    assert.equal(fs.existsSync(installedKey) ? fs.statSync(installedKey).mtimeMs : null, installedKeyBefore,
      'a database at its own root must not write key material into the installation data directory');
    db.close();

    const reopened = new JarvisDatabase({ dataRoot });
    assert.equal(reopened.providerApiKey(created.id), 'file-backed-secret');
    reopened.close();

    // An environment-supplied salt is external configuration and needs no file.
    process.env.JARVIS_KEY_SALT = 'portable-salt';
    const envRoot = path.join(directory, 'env-data');
    const envDb = new JarvisDatabase({ dataRoot: envRoot });
    const envProvider = envDb.addProvider({ ...details, api_key: 'env-backed-secret' });
    assert.equal(envDb.providerApiKey(envProvider.id), 'env-backed-secret');
    assert.ok(!fs.existsSync(path.join(envRoot, 'provider.key')));
    envDb.close();
  } finally {
    if (originalSalt === undefined) delete process.env.JARVIS_KEY_SALT; else process.env.JARVIS_KEY_SALT = originalSalt;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a reviewed workspace edit is terminal and an approved one migrates to the applied status', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-edits-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');
  const db = new JarvisDatabase(dbPath);

  try {
    const edit = db.proposeWorkspaceEdit('/tmp/a.txt', 'body', 'because');
    assert.equal(edit.status, 'pending_review');

    assert.equal(db.updateWorkspaceEditStatus(edit.id, 'rejected').status, 'rejected');
    assert.throws(() => db.updateWorkspaceEditStatus(edit.id, 'approved_and_applied'), (error) => error.code === 'conflict');
    assert.throws(() => db.updateWorkspaceEditStatus(edit.id, 'rejected'), (error) => error.code === 'conflict');
    assert.equal(db.workspaceEdit(edit.id).status, 'rejected', 'a refused transition leaves the record unchanged');

    assert.throws(() => db.updateWorkspaceEditStatus('no-such-edit', 'rejected'), (error) => error.code === 'not_found');
    db.close();

    // A row stored under the previous status vocabulary is migrated in place.
    const legacy = new DatabaseSync(dbPath);
    legacy.prepare('INSERT INTO workspace_edits VALUES(?,?,?,?,?,?,?)').run('old', '/tmp/b.txt', 'body', 'r', 'approved', 'n', 'n');
    legacy.close();

    const reopened = new JarvisDatabase(dbPath);
    assert.equal(reopened.workspaceEdit('old').status, 'approved_and_applied');
    reopened.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the client status unions mirror the runtime contract', () => {
  const types = fs.readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
  const unionAfter = (field, marker) => {
    const line = types.slice(types.indexOf(marker)).match(new RegExp(`${field}: ([^;]+);`))[1];
    return [...line.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  };

  assert.deepEqual(unionAfter('status', 'export interface WorkspaceEdit'), [...WORKSPACE_EDIT_STATES].sort());
  assert.deepEqual(unionAfter('status', 'export interface McpServer'), [...MCP_HEALTH_STATES].sort());
});

test('every added index serves its owning query, and list queries break ties deterministically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-index-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  try {
    const plan = (sql) => db.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('probe').map((row) => row.detail).join(' | ');

    const owned = [
      ['idx_messages_conversation', 'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, id'],
      ['idx_agent_runs_conversation', 'SELECT * FROM agent_runs WHERE conversation_id=? ORDER BY started_at DESC, id DESC'],
      ['idx_workspace_edits_status', 'SELECT * FROM workspace_edits WHERE status=? ORDER BY created_at DESC, id DESC'],
      ['idx_memories_category', 'SELECT * FROM memories WHERE category=? ORDER BY updated_at DESC, id DESC'],
    ];
    for (const [index, sql] of owned) {
      const detail = plan(sql);
      assert.ok(detail.includes(index), `${index} serves its query — got: ${detail}`);
      assert.ok(!detail.includes('TEMP B-TREE'), `${index} also covers the ordering — got: ${detail}`);
    }

    // No index exists that no query asked for.
    const declared = db.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all().map((row) => row.name).sort();
    assert.deepEqual(declared, owned.map(([index]) => index).sort());

    // Rows written within the same timestamp still come back in one fixed order.
    const conversation = db.createConversation('ties');
    for (const role of ['user', 'assistant', 'user']) db.addMessage(conversation.id, role, `${role} message`);
    const first = db.messages(conversation.id).map((row) => row.id);
    assert.deepEqual(db.messages(conversation.id).map((row) => row.id), first);
    assert.equal(new Set(first).size, 3);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
