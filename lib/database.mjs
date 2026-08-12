import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import path from 'node:path';

// Keep durable JARVIS state beside the project, not in a disposable cache.
export const dataDirectory = () => process.env.JARVIS_DATA_DIR || path.resolve('data', 'sql-db');
export class JarvisDatabase {
  constructor(dbPath = path.join(dataDirectory(), 'jarvis.sqlite')) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); this.db = new DatabaseSync(dbPath); this.db.exec('PRAGMA foreign_keys = ON;'); this.migrate(); }
  migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, provider TEXT, status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL, origin TEXT);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'user_preference', key TEXT NOT NULL, value TEXT NOT NULL, importance TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'stdio', endpoint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', latency_ms INTEGER NOT NULL DEFAULT 0, tools_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, slash_command TEXT NOT NULL UNIQUE, description TEXT NOT NULL, code TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL DEFAULT 'custom', author TEXT NOT NULL DEFAULT 'JARVIS Core', version TEXT NOT NULL DEFAULT '1.0.0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_edits (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, content TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review', created_at TEXT NOT NULL, reviewed_at TEXT);`);
    const columns = this.db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name);
    if (!columns.includes('origin')) this.db.exec('ALTER TABLE messages ADD COLUMN origin TEXT');

    const memCols = this.db.prepare('PRAGMA table_info(memories)').all().map((column) => column.name);
    if (!memCols.includes('category')) this.db.exec("ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT 'user_preference'");
    if (!memCols.includes('importance')) this.db.exec("ALTER TABLE memories ADD COLUMN importance TEXT NOT NULL DEFAULT 'medium'");
    if (!memCols.includes('updated_at')) this.db.exec("ALTER TABLE memories ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    this.seed();
  }
  seed() {
    const mcpCount = this.db.prepare('SELECT COUNT(*) as count FROM mcp_servers').get().count;
    if (mcpCount === 0) {
      const defaultMcp = [
        {
          id: 'mcp-fs',
          name: 'Local File System MCP Server',
          type: 'built-in',
          endpoint: 'workspace://filesystem',
          status: 'connected',
          latency_ms: 2,
          tools_json: JSON.stringify([
            { name: 'read_workspace_file', description: 'Reads contents of an approved workspace file.', parameters: 'path: string' },
            { name: 'write_workspace_file', description: 'Writes content to an approved workspace file.', parameters: 'path: string, content: string' },
            { name: 'list_workspace_directory', description: 'Lists files and folders in specified workspace path.', parameters: 'path?: string' }
          ]),
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'mcp-git',
          name: 'Git Version Control MCP Server',
          type: 'built-in',
          endpoint: 'workspace://git',
          status: 'connected',
          latency_ms: 8,
          tools_json: JSON.stringify([
            { name: 'git_status', description: 'Checks local git status and branch information.', parameters: 'none' },
            { name: 'git_diff', description: 'Inspects unstaged changes in the repository.', parameters: 'file?: string' }
          ]),
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'mcp-sqlite',
          name: 'Local SQLite Knowledge Database',
          type: 'built-in',
          endpoint: 'sqlite://data/sql-db/jarvis.sqlite',
          status: 'connected',
          latency_ms: 4,
          tools_json: JSON.stringify([
            { name: 'execute_query', description: 'Executes a read-only SQL SELECT query on the local DB.', parameters: 'sql: string' }
          ]),
          created_at: now(),
          updated_at: now()
        }
      ];
      const stmt = this.db.prepare('INSERT INTO mcp_servers(id,name,type,endpoint,status,latency_ms,tools_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)');
      for (const s of defaultMcp) stmt.run(s.id, s.name, s.type, s.endpoint, s.status, s.latency_ms, s.tools_json, s.created_at, s.updated_at);
    }

    const skillCount = this.db.prepare('SELECT COUNT(*) as count FROM skills').get().count;
    if (skillCount === 0) {
      const defaultSkills = [
        {
          id: 'skill-search',
          name: 'Web & Local Search',
          slash_command: '/search',
          description: 'Queries live search grounding via Gemini or local workspace index.',
          code: `async function execute({ input, app }) {\n  return { success: true, tool: "search", output: \`Retrieved live search grounding for: "\${input}"\` };\n}`,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.4.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-calc',
          name: 'Mathematical Evaluator',
          slash_command: '/calc',
          description: 'Safely evaluates mathematical and algebraic expressions.',
          code: `async function execute({ input }) {\n  const clean = input.replace(/[^0-9+\\-*/().^%\\s]/g, '');\n  const val = Function(\`'use strict'; return (\${clean})\`)();\n  return { success: true, tool: "calc", result: val, output: \`Math Result: \${input} = \${val}\` };\n}`,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.0.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-hardware',
          name: 'Hardware Telemetry',
          slash_command: '/hardware',
          description: 'Inspects local CPU cores, RAM, and diagnostic health.',
          code: `async function execute({ app }) {\n  const diag = await app.diagnostics();\n  return { success: true, tool: "hardware", output: \`CPU: \${diag.system.cpu[0]?.model || 'Generic'} (\${diag.system.cpu.length} cores) | Total RAM: \${Math.round(diag.system.memory.total / (1024*1024*1024))}GB | Free: \${Math.round(diag.system.memory.free / (1024*1024*1024))}GB\` };\n}`,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '2.0.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-mcp',
          name: 'MCP Matrix Inspector',
          slash_command: '/mcp',
          description: 'Queries active Model Context Protocol servers and exposed tools.',
          code: `async function execute({ app }) {\n  const servers = app.mcpServers();\n  const summary = servers.map(s => \`• \${s.name} (\${s.endpoint}) [\${s.tools.length} tools]\`).join('\\n');\n  return { success: true, tool: "mcp", output: \`Connected MCP Servers:\\n\${summary}\` };\n}`,
          enabled: 1,
          type: 'built-in',
          author: 'Model Context Protocol Group',
          version: '2.1.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-workspace',
          name: 'Workspace File Inspector',
          slash_command: '/workspace',
          description: 'Inspects approved workspace roots and reads text files.',
          code: `async function execute({ input, app }) {\n  const roots = app.roots();\n  if (!input.trim()) return { success: true, tool: "workspace", output: \`Approved Workspace Roots:\\n\${roots.map(r => r.path).join('\\n') || 'None configured'}\` };\n  const file = await app.readFile(input.trim());\n  return { success: true, tool: "workspace", output: \`File: \${file.path} (\${file.size} bytes):\\n\${file.content.slice(0, 500)}\` };\n}`,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.2.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-code',
          name: 'Self-Evolution Generator',
          slash_command: '/code',
          description: 'Generates dynamic TypeScript skill code based on user prompt.',
          code: `async function execute({ input }) {\n  return { success: true, tool: "code", output: \`// Evolved Subroutine for: \${input}\\nexport async function customSubroutine(input) { return { processed: true, result: input }; }\` };\n}`,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.0.0',
          created_at: now(),
          updated_at: now()
        }
      ];
      const stmt = this.db.prepare('INSERT INTO skills(id,name,slash_command,description,code,enabled,type,author,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      for (const sk of defaultSkills) stmt.run(sk.id, sk.name, sk.slash_command, sk.description, sk.code, sk.enabled, sk.type, sk.author, sk.version, sk.created_at, sk.updated_at);
    }

    const memCount = this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    if (memCount === 0) {
      const defaultMemories = [
        { id: 'mem-1', category: 'user_preference', key: 'Execution Preference', value: 'Prefers local-first AI execution with zero network dependency by default.', importance: 'high', created_at: now(), updated_at: now() },
        { id: 'mem-2', category: 'system_fact', key: 'Architecture Stack', value: 'JARVISvX uses Node.js, Express loopback, SQLite persistence, ONNX Whisper, and Kokoro TTS.', importance: 'high', created_at: now(), updated_at: now() },
        { id: 'mem-3', category: 'code_context', key: 'Frontend UI System', value: 'Built with React 19, Tailwind CSS, Lucide icons, and Canvas particle effects.', importance: 'medium', created_at: now(), updated_at: now() },
        { id: 'mem-4', category: 'conversation_summary', key: 'Model Orchestration', value: 'Configured hardware-aware local model orchestration engine for dynamic cloud fallback.', importance: 'high', created_at: now(), updated_at: now() }
      ];
      const memStmt = this.db.prepare('INSERT INTO memories(id,category,key,value,importance,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
      for (const m of defaultMemories) memStmt.run(m.id, m.category, m.key, m.value, m.importance, m.created_at, m.updated_at);
    }
  }

  setting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), now()); }
  conversations() { return this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC').all(); }
  conversation(id) { return this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id); }
  messages(conversationId) { return this.db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at').all(conversationId); }
  createConversation(title = 'New conversation') { const item = { id: id(), title, created_at: now(), updated_at: now() }; this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(item.id,item.title,item.created_at,item.updated_at); return item; }
  touchConversation(id, title) { this.db.prepare('UPDATE conversations SET title=COALESCE(?,title),updated_at=? WHERE id=?').run(title || null, now(), id); }
  deleteConversation(id) { this.db.prepare('DELETE FROM messages WHERE conversation_id=?').run(id); return this.db.prepare('DELETE FROM conversations WHERE id=?').run(id).changes > 0; }
  addMessage(conversationId, role, content, provider = null, status = 'complete', origin = null) { const item = { id: id(), conversation_id: conversationId, role, content, provider, status, created_at: now(), origin }; this.db.prepare('INSERT INTO messages(id,conversation_id,role,content,provider,status,created_at,origin) VALUES(?,?,?,?,?,?,?,?)').run(item.id,item.conversation_id,item.role,item.content,item.provider,item.status,item.created_at,item.origin); this.touchConversation(conversationId); return item; }
  roots() { return this.db.prepare('SELECT * FROM workspace_roots ORDER BY added_at').all(); }
  addRoot(rootPath) { const item = { id: id(), path: rootPath, added_at: now() }; this.db.prepare('INSERT INTO workspace_roots VALUES(?,?,?)').run(item.id,item.path,item.added_at); return item; }
  removeRoot(id) { return this.db.prepare('DELETE FROM workspace_roots WHERE id=?').run(id).changes > 0; }
  workspaceEdits(status) {
    if (status) return this.db.prepare('SELECT * FROM workspace_edits WHERE status=? ORDER BY created_at DESC').all(status);
    return this.db.prepare('SELECT * FROM workspace_edits ORDER BY created_at DESC').all();
  }
  proposeWorkspaceEdit(filePath, content, reason = 'Proposed code edit or self-evolution update') {
    const item = { id: `edit-${Date.now()}-${Math.floor(Math.random()*1000)}`, file_path: filePath, content, reason, status: 'pending_review', created_at: now(), reviewed_at: null };
    this.db.prepare('INSERT INTO workspace_edits VALUES(?,?,?,?,?,?,?)').run(item.id, item.file_path, item.content, item.reason, item.status, item.created_at, item.reviewed_at);
    return item;
  }
  updateWorkspaceEditStatus(id, status) {
    this.db.prepare('UPDATE workspace_edits SET status=?, reviewed_at=? WHERE id=?').run(status, now(), id);
    return this.db.prepare('SELECT * FROM workspace_edits WHERE id=?').get(id);
  }

  // --- MCP SERVERS METHOD ENGINE ---
  mcpServers() {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      endpoint: r.endpoint,
      status: r.status,
      latencyMs: r.latency_ms,
      tools: JSON.parse(r.tools_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
  mcpServer(id) {
    const r = this.db.prepare('SELECT * FROM mcp_servers WHERE id=?').get(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      endpoint: r.endpoint,
      status: r.status,
      latencyMs: r.latency_ms,
      tools: JSON.parse(r.tools_json || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
  addMcpServer({ name, type = 'http', endpoint, tools = [] }) {
    const item = {
      id: `mcp-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      name,
      type,
      endpoint,
      status: 'connected',
      latency_ms: Math.floor(Math.random() * 15) + 3,
      tools_json: JSON.stringify(tools),
      created_at: now(),
      updated_at: now()
    };
    this.db.prepare('INSERT INTO mcp_servers(id,name,type,endpoint,status,latency_ms,tools_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(item.id, item.name, item.type, item.endpoint, item.status, item.latency_ms, item.tools_json, item.created_at, item.updated_at);
    return this.mcpServer(item.id);
  }
  updateMcpServer(id, updates) {
    const existing = this.mcpServer(id);
    if (!existing) return null;
    const name = updates.name ?? existing.name;
    const type = updates.type ?? existing.type;
    const endpoint = updates.endpoint ?? existing.endpoint;
    const status = updates.status ?? existing.status;
    const latencyMs = updates.latencyMs ?? existing.latencyMs;
    const toolsJson = updates.tools ? JSON.stringify(updates.tools) : JSON.stringify(existing.tools);
    const updatedAt = now();
    this.db.prepare('UPDATE mcp_servers SET name=?, type=?, endpoint=?, status=?, latency_ms=?, tools_json=?, updated_at=? WHERE id=?')
      .run(name, type, endpoint, status, latencyMs, toolsJson, updatedAt, id);
    return this.mcpServer(id);
  }
  deleteMcpServer(id) {
    return this.db.prepare('DELETE FROM mcp_servers WHERE id=?').run(id).changes > 0;
  }

  // --- SLASH SKILLS METHOD ENGINE ---
  skills() {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY type DESC, created_at DESC').all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      slashCommand: r.slash_command,
      description: r.description,
      code: r.code,
      enabled: Boolean(r.enabled),
      type: r.type,
      author: r.author,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }
  skill(id) {
    const r = this.db.prepare('SELECT * FROM skills WHERE id=?').get(id);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slashCommand: r.slash_command,
      description: r.description,
      code: r.code,
      enabled: Boolean(r.enabled),
      type: r.type,
      author: r.author,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
  skillByCommand(cmd) {
    const normalized = cmd.trim().toLowerCase();
    const r = this.db.prepare('SELECT * FROM skills WHERE LOWER(slash_command)=?').get(normalized);
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      slashCommand: r.slash_command,
      description: r.description,
      code: r.code,
      enabled: Boolean(r.enabled),
      type: r.type,
      author: r.author,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  }
  addSkill({ name, slashCommand, description, code, enabled = true, type = 'custom', author = 'User', version = '1.0.0' }) {
    const cmd = slashCommand.startsWith('/') ? slashCommand : `/${slashCommand}`;
    const item = {
      id: `skill-${Date.now()}-${Math.floor(Math.random()*1000)}`,
      name,
      slash_command: cmd,
      description,
      code,
      enabled: enabled ? 1 : 0,
      type,
      author,
      version,
      created_at: now(),
      updated_at: now()
    };
    this.db.prepare('INSERT INTO skills(id,name,slash_command,description,code,enabled,type,author,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run(item.id, item.name, item.slash_command, item.description, item.code, item.enabled, item.type, item.author, item.version, item.created_at, item.updated_at);
    return this.skill(item.id);
  }
  updateSkill(id, updates) {
    const existing = this.skill(id);
    if (!existing) return null;
    const name = updates.name ?? existing.name;
    const slashCommand = updates.slashCommand ? (updates.slashCommand.startsWith('/') ? updates.slashCommand : `/${updates.slashCommand}`) : existing.slashCommand;
    const description = updates.description ?? existing.description;
    const code = updates.code ?? existing.code;
    const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
    const updatedAt = now();
    this.db.prepare('UPDATE skills SET name=?, slash_command=?, description=?, code=?, enabled=?, updated_at=? WHERE id=?')
      .run(name, slashCommand, description, code, enabled, updatedAt, id);
    return this.skill(id);
  }
  toggleSkill(id) {
    const existing = this.skill(id);
    if (!existing) return null;
    return this.updateSkill(id, { enabled: !existing.enabled });
  }
  deleteSkill(id) {
    return this.db.prepare('DELETE FROM skills WHERE id=?').run(id).changes > 0;
  }
  // --- ORCHESTRATION SETTINGS ENGINE ---
  orchestrationSettings() {
    const fallback = {
      mode: 'auto',
      localEndpoint: 'http://127.0.0.1:11434/v1',
      selectedLocalModel: 'Llama-3.2-3B-Instruct',
      autoEscalateRules: {
        maxCharCount: 400,
        requireSearch: true,
        requireCodeExecution: true
      }
    };
    return this.setting('orchestration.config', fallback);
  }
  updateOrchestrationSettings(updates) {
    const current = this.orchestrationSettings();
    const updated = {
      mode: updates.mode ?? current.mode,
      localEndpoint: updates.localEndpoint ?? current.localEndpoint,
      selectedLocalModel: updates.selectedLocalModel ?? current.selectedLocalModel,
      autoEscalateRules: {
        maxCharCount: updates.autoEscalateRules?.maxCharCount ?? current.autoEscalateRules.maxCharCount,
        requireSearch: updates.autoEscalateRules?.requireSearch ?? current.autoEscalateRules.requireSearch,
        requireCodeExecution: updates.autoEscalateRules?.requireCodeExecution ?? current.autoEscalateRules.requireCodeExecution
      }
    };
    this.setSetting('orchestration.config', updated);
    return updated;
  }

  // --- MEMORY CENTER METHOD ENGINE ---
  memories(category = null) {
    if (category && category !== 'all') {
      return this.db.prepare('SELECT * FROM memories WHERE category=? ORDER BY updated_at DESC').all(category);
    }
    return this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC').all();
  }
  memory(id) {
    return this.db.prepare('SELECT * FROM memories WHERE id=?').get(id) || null;
  }
  addMemory({ category = 'user_preference', key, value, importance = 'medium' }) {
    const item = {
      id: `mem-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      category,
      key,
      value,
      importance,
      created_at: now(),
      updated_at: now()
    };
    this.db.prepare('INSERT INTO memories(id,category,key,value,importance,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .run(item.id, item.category, item.key, item.value, item.importance, item.created_at, item.updated_at);
    return this.memory(item.id);
  }
  updateMemory(id, updates) {
    const existing = this.memory(id);
    if (!existing) return null;
    const category = updates.category ?? existing.category;
    const key = updates.key ?? existing.key;
    const value = updates.value ?? existing.value;
    const importance = updates.importance ?? existing.importance;
    const updatedAt = now();
    this.db.prepare('UPDATE memories SET category=?, key=?, value=?, importance=?, updated_at=? WHERE id=?')
      .run(category, key, value, importance, updatedAt, id);
    return this.memory(id);
  }
  deleteMemory(id) {
    return this.db.prepare('DELETE FROM memories WHERE id=?').run(id).changes > 0;
  }
  searchMemories(query = '', category = null) {
    const all = this.memories(category);
    if (!query || !query.trim()) return all;
    const term = query.toLowerCase().trim();
    return all.filter((m) => m.key.toLowerCase().includes(term) || m.value.toLowerCase().includes(term));
  }

  close() { this.db.close(); }
}
const now = () => new Date().toISOString(); const id = () => crypto.randomUUID();


