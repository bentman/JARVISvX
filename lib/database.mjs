import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import path from 'node:path';

// Keep durable JARVIS state beside the project, not in a disposable cache.
export const dataDirectory = () => process.env.JARVIS_DATA_DIR || path.resolve('data', 'sql-db');
export class JarvisDatabase {
  constructor(dbPath = path.join(dataDirectory(), 'jarvis.sqlite')) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); this.db = new DatabaseSync(dbPath); this.db.exec('PRAGMA foreign_keys = ON;'); this.migrate(); }
  migrate() { this.db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, provider TEXT, status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL, origin TEXT); CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL);`); const columns = this.db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name); if (!columns.includes('origin')) this.db.exec('ALTER TABLE messages ADD COLUMN origin TEXT'); }
  setting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), now()); }
  conversations() { return this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all(); }
  conversation(id) { return this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id); }
  messages(conversationId) { return this.db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at').all(conversationId); }
  createConversation(title = 'New conversation') { const item = { id: id(), title, created_at: now(), updated_at: now() }; this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(item.id,item.title,item.created_at,item.updated_at); return item; }
  touchConversation(id, title) { this.db.prepare('UPDATE conversations SET title=COALESCE(?,title),updated_at=? WHERE id=?').run(title || null, now(), id); }
  addMessage(conversationId, role, content, provider = null, status = 'complete', origin = null) { const item = { id: id(), conversation_id: conversationId, role, content, provider, status, created_at: now(), origin }; this.db.prepare('INSERT INTO messages(id,conversation_id,role,content,provider,status,created_at,origin) VALUES(?,?,?,?,?,?,?,?)').run(item.id,item.conversation_id,item.role,item.content,item.provider,item.status,item.created_at,item.origin); this.touchConversation(conversationId); return item; }
  roots() { return this.db.prepare('SELECT * FROM workspace_roots ORDER BY added_at').all(); }
  addRoot(rootPath) { const item = { id: id(), path: rootPath, added_at: now() }; this.db.prepare('INSERT INTO workspace_roots VALUES(?,?,?)').run(item.id,item.path,item.added_at); return item; }
  removeRoot(id) { return this.db.prepare('DELETE FROM workspace_roots WHERE id=?').run(id).changes > 0; }
  close() { this.db.close(); }
}
const now = () => new Date().toISOString(); const id = () => crypto.randomUUID();
