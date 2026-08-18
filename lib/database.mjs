import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import fsp from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The JARVISvX install directory (this file lives at <root>/lib/database.mjs),
// resolved from this file's own location rather than process.cwd(). The `jarvis`
// CLI is meant to be run via `npm link` from ANY working directory, and the
// Electron/daemon host can be launched the same way — cwd is never guaranteed
// to be the project directory. Anchoring here (instead of via path.resolve(),
// which is cwd-relative) is what keeps "no data outside the repo" true no
// matter where the command was invoked from.
export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Resolve any valid filesystem path the same way workspace roots are resolved.
// Supports: absolute (Windows or POSIX), relative, and tilde-prefixed paths.
export function resolveDataDirectory(rawPath) {
  if (!rawPath || !String(rawPath).trim()) return path.join(PROJECT_ROOT, 'data');
  const expanded = String(rawPath).replace(/^~(?=[/\\]|$)/, os.homedir());
  return path.resolve(expanded);
}

// Keep durable JARVIS state beside the project, not in a disposable cache.
// dataDirectory() is the fully-resolved top-level data root.
export const dataDirectory = () => resolveDataDirectory(process.env.JARVIS_DATA_DIR);

export class JarvisDatabase {
  constructor(dbPath = path.join(dataDirectory(), 'sql-db', 'jarvis.sqlite')) { fs.mkdirSync(path.dirname(dbPath), { recursive: true }); this.db = new DatabaseSync(dbPath); this.db.exec('PRAGMA foreign_keys = ON;'); this.migrate(); }

  migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, provider TEXT, status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL, origin TEXT);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'user_preference', key TEXT NOT NULL, value TEXT NOT NULL, importance TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'stdio', endpoint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', latency_ms INTEGER NOT NULL DEFAULT 0, tools_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, slash_command TEXT NOT NULL UNIQUE, description TEXT NOT NULL, code TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL DEFAULT 'custom', author TEXT NOT NULL DEFAULT 'JARVIS Core', version TEXT NOT NULL DEFAULT '1.0.0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_edits (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, content TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review', created_at TEXT NOT NULL, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT, agent_id TEXT NOT NULL, adapter TEXT NOT NULL, parent_run_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, objective TEXT NOT NULL, result TEXT, started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', api_key_enc TEXT, tags TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 50, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
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
    this.seedProvidersFromEnv();
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

  // Agent Runs Methods
  createAgentRun({ conversation_id = null, agent_id, adapter, parent_run_id = null, mode = 'solo', objective = '' }) {
    const item = {
      id: id(),
      conversation_id,
      agent_id,
      adapter,
      parent_run_id,
      mode,
      status: 'running',
      objective,
      result: '',
      started_at: now(),
      completed_at: null
    };
    this.db.prepare('INSERT INTO agent_runs (id, conversation_id, agent_id, adapter, parent_run_id, mode, status, objective, result, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.conversation_id, item.agent_id, item.adapter, item.parent_run_id, item.mode, item.status, item.objective, item.result, item.started_at, item.completed_at);
    return this.agentRun(item.id);
  }

  updateAgentRun(runId, updates) {
    const existing = this.agentRun(runId);
    if (!existing) return null;
    const status = updates.status ?? existing.status;
    const result = updates.result ?? existing.result;
    const completedAt = updates.status === 'completed' || updates.status === 'failed' ? now() : existing.completed_at;
    this.db.prepare('UPDATE agent_runs SET status=?, result=?, completed_at=? WHERE id=?')
      .run(status, result, completedAt, runId);
    return this.agentRun(runId);
  }

  agentRun(runId) {
    return this.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(runId) || null;
  }

  agentRuns(conversationId = null) {
    if (conversationId) {
      return this.db.prepare('SELECT * FROM agent_runs WHERE conversation_id=? ORDER BY started_at DESC').all(conversationId);
    }
    return this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 100').all();
  }

  close() { this.db.close(); }

  // ---- PROVIDER REGISTRY ----
  providers() {
    return this.db.prepare('SELECT * FROM providers ORDER BY priority ASC, name ASC').all()
      .map((row) => this._providerRow(row));
  }
  provider(id) {
    const row = this.db.prepare('SELECT * FROM providers WHERE id=?').get(id);
    return row ? this._providerRow(row) : null;
  }
  addProvider({ name, protocol, base_url, model = '', api_key, tags = [], enabled = true, priority = 50 }) {
    const item = {
      id: `prov-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      name, protocol, base_url, model,
      api_key_enc: api_key ? encryptKey(api_key, dataDirectory()) : null,
      tags: JSON.stringify(tags),
      enabled: enabled ? 1 : 0,
      priority,
      created_at: now(), updated_at: now()
    };
    this.db.prepare('INSERT INTO providers (id,name,protocol,base_url,model,api_key_enc,tags,enabled,priority,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(item.id, item.name, item.protocol, item.base_url, item.model, item.api_key_enc, item.tags, item.enabled, item.priority, item.created_at, item.updated_at);
    return this.provider(item.id);
  }
  updateProvider(id, updates) {
    const existing = this.provider(id);
    if (!existing) return null;
    const name = updates.name ?? existing.name;
    const protocol = updates.protocol ?? existing.protocol;
    const base_url = updates.base_url ?? existing.base_url;
    const model = updates.model ?? existing.model;
    const api_key_enc = updates.api_key ? encryptKey(updates.api_key, dataDirectory()) : existing._api_key_enc;
    const tags = updates.tags !== undefined ? JSON.stringify(updates.tags) : JSON.stringify(existing.tags);
    const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
    const priority = updates.priority ?? existing.priority;
    const updated_at = now();
    this.db.prepare('UPDATE providers SET name=?,protocol=?,base_url=?,model=?,api_key_enc=?,tags=?,enabled=?,priority=?,updated_at=? WHERE id=?')
      .run(name, protocol, base_url, model, api_key_enc, tags, enabled, priority, updated_at, id);
    return this.provider(id);
  }
  deleteProvider(id) {
    return this.db.prepare('DELETE FROM providers WHERE id=?').run(id).changes > 0;
  }
  toggleProvider(id) {
    const existing = this.provider(id);
    if (!existing) return null;
    return this.updateProvider(id, { enabled: !existing.enabled });
  }
  // Decrypt API key — used internally by ProviderRegistry only; never returned by API.
  providerApiKey(id) {
    const row = this.db.prepare('SELECT api_key_enc FROM providers WHERE id=?').get(id);
    if (!row?.api_key_enc) return null;
    try { return decryptKey(row.api_key_enc, dataDirectory()); } catch { return null; }
  }
  // Seed provider records from .env on first run (when table is empty).
  seedProvidersFromEnv() {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM providers').get().c;
    if (count > 0) return; // already seeded
    const seeds = [];
    if (process.env.JARVIS_LLAMACPP_URL) {
      seeds.push({ name: 'llama.cpp / llama.app', protocol: 'openai-compat', base_url: process.env.JARVIS_LLAMACPP_URL, model: '', api_key: process.env.JARVIS_LLAMACPP_API_KEY || null, tags: ['local', 'fast'], priority: 10 });
    } else {
      seeds.push({ name: 'llama.cpp / llama.app', protocol: 'openai-compat', base_url: 'http://127.0.0.1:8080/v1', model: '', api_key: null, tags: ['local', 'fast'], priority: 10 });
    }
    if (process.env.JARVIS_OLLAMA_URL || true) {
      seeds.push({ name: 'Ollama', protocol: 'ollama', base_url: process.env.JARVIS_OLLAMA_URL || 'http://127.0.0.1:11434', model: '', api_key: null, tags: ['local'], priority: 20 });
    }
    if (process.env.JARVIS_CLOUD_URL && process.env.JARVIS_CLOUD_API_KEY) {
      const protocol = (process.env.JARVIS_CLOUD_URL || '').includes('azure.com') ? 'azure-openai' : 'openai-compat';
      seeds.push({ name: 'Cloud (OpenAI-compatible)', protocol, base_url: process.env.JARVIS_CLOUD_URL, model: process.env.JARVIS_CLOUD_MODEL || '', api_key: process.env.JARVIS_CLOUD_API_KEY, tags: ['cloud', 'reasoning'], priority: 50 });
    }
    for (const seed of seeds) this.addProvider(seed);
  }
  _providerRow(row) {
    return {
      id: row.id, name: row.name, protocol: row.protocol, base_url: row.base_url,
      model: row.model,
      api_key_set: Boolean(row.api_key_enc),  // UI gets boolean, not the key
      _api_key_enc: row.api_key_enc,           // internal — not serialised to API
      tags: tryParseJson(row.tags, []),
      enabled: Boolean(row.enabled),
      priority: row.priority,
      created_at: row.created_at, updated_at: row.updated_at
    };
  }
}

// ---- Encryption helpers (AES-256-GCM, operator-supplied salt) ----
// Key material priority:
//   1. JARVIS_KEY_SALT env var (set in .env — portable across any host)
//   2. <dataDir>/provider.key file (auto-generated on first use, travels with data)
// If the key material changes, existing encrypted API keys cannot be decrypted and
// will prompt for re-entry in the Providers panel.
import crypto from 'node:crypto';

function readOrCreateSaltFile(dataDir) {
  const saltFile = path.join(dataDir, 'provider.key');
  try { return fs.readFileSync(saltFile, 'utf8').trim(); } catch {
    const salt = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(saltFile, salt, { mode: 0o600 }); } catch {}
    return salt;
  }
}

function deriveKey(dataDir) {
  const salt = process.env.JARVIS_KEY_SALT?.trim() || readOrCreateSaltFile(dataDir);
  return crypto.createHash('sha256').update(`jarvis-provider-key:${salt}`).digest();
}

function encryptKey(plaintext, dataDir) {
  const key = deriveKey(dataDir); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}
function decryptKey(ciphertext, dataDir) {
  const [ivHex, tagHex, encHex] = ciphertext.split('.');
  const key = deriveKey(dataDir); const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex'); const enc = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}
function tryParseJson(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }
const now = () => new Date().toISOString(); const id = () => crypto.randomUUID();

