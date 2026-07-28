import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';

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
