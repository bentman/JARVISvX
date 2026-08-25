import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase, PROJECT_ROOT } from '../lib/database.mjs';

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
    const db = new JarvisDatabase({ dataRoot });
    const created = db.addProvider({ ...details, api_key: 'file-backed-secret' });

    assert.equal(db.providerApiKey(created.id), 'file-backed-secret');
    assert.ok(fs.existsSync(path.join(dataRoot, 'provider.key')), 'key material belongs beside its database');
    assert.ok(!fs.existsSync(path.join(PROJECT_ROOT, 'data', 'provider.key')),
      'a database at its own root must not write key material into the installation data directory');
    db.close();

    assert.equal(new JarvisDatabase({ dataRoot }).providerApiKey(created.id), 'file-backed-secret');

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
