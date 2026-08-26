import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs'; import fsp from 'node:fs/promises'; import path from 'node:path';
import { PROJECT_ROOT, resolveRuntimePath } from './runtime-paths.mjs';
import { canTransition } from './contracts.mjs';

export { PROJECT_ROOT };

export function resolveDataDirectory(rawPath) {
  return resolveRuntimePath(rawPath, path.join(PROJECT_ROOT, 'data'));
}

// dataDirectory() is the fully-resolved top-level data root.
export const dataDirectory = () => resolveDataDirectory(process.env.JARVIS_DATA_DIR);

// Seed and migration share code constants so upgrade matching is exact.
const SEARCH_SKILL_CODE_V1 = `async function execute({ input, app }) {\n  return { success: true, tool: "search", output: \`Retrieved live search grounding for: "\${input}"\` };\n}`;
const SEARCH_SKILL_CODE_V2 = `async function execute({ input, app }) {\n  const query = (input || '').trim();\n  if (!query) return { success: false, tool: "search", output: 'Usage: /search <query> — searches file names and contents across approved workspace roots.' };\n  const result = await app.searchWorkspace(query);\n  if (!result.results.length) return { success: true, tool: "search", output: \`No matches for "\${query}" across \${result.roots.length} approved workspace root(s).\` };\n  const lines = result.results.map(r => r.matchType === 'name' ? \`\${r.relativePath} (filename match)\` : \`\${r.relativePath}:\${r.line}  \${r.snippet}\`);\n  return { success: true, tool: "search", output: \`\${result.results.length} match(es) for "\${query}"\${result.truncated ? ' (truncated)' : ''}:\\n\${lines.join('\\n')}\` };\n}`;

const CODE_SKILL_CODE_V1 = `async function execute({ input }) {\n  return { success: true, tool: "code", output: \`// Evolved Subroutine for: \${input}\\nexport async function customSubroutine(input) { return { processed: true, result: input }; }\` };\n}`;
const CODE_SKILL_CODE_V2 = `async function execute({ input, app }) {\n  const prompt = (input || '').trim();\n  if (!prompt) return { success: false, tool: "code", output: 'Usage: /code <description of what to generate>' };\n  const provider = app.getProvider();\n  const model = app.modelFor(provider.id) || (await provider.listModels().catch(() => []))[0] || provider.model;\n  if (!model) return { success: false, tool: "code", output: \`No model selected for \${provider.label}. Choose one in Settings first.\` };\n  let code = '';\n  for await (const piece of provider.streamChat({ messages: [\n    { role: 'system', content: 'You write code. Reply with only the code for the request \\u2014 no explanation, no markdown code fences.' },\n    { role: 'user', content: prompt }\n  ], model })) {\n    if (typeof piece === 'string') code += piece;\n  }\n  code = code.trim();\n  return { success: true, tool: "code", output: code || 'The model returned no code.' };\n}`;

const CALC_SKILL_CODE_V1 = `async function execute({ input }) {\n  const clean = input.replace(/[^0-9+\\-*/().^%\\s]/g, '');\n  const val = Function(\`'use strict'; return (\${clean})\`)();\n  return { success: true, tool: "calc", result: val, output: \`Math Result: \${input} = \${val}\` };\n}`;
const HARDWARE_SKILL_CODE_V2 = `async function execute({ app }) {\n  const diag = await app.diagnostics();\n  return { success: true, tool: "hardware", output: \`CPU: \${diag.system.cpu[0]?.model || 'Generic'} (\${diag.system.cpu.length} cores) | Total RAM: \${Math.round(diag.system.memory.total / (1024*1024*1024))}GB | Free: \${Math.round(diag.system.memory.free / (1024*1024*1024))}GB\` };\n}`;
const MCP_SKILL_CODE_V2 = `async function execute({ app }) {\n  const servers = app.mcpServers();\n  const summary = servers.map(s => \`• \${s.name} (\${s.endpoint}) [\${s.tools.length} tools]\`).join('\\n');\n  return { success: true, tool: "mcp", output: \`Connected MCP Servers:\\n\${summary}\` };\n}`;
const WORKSPACE_SKILL_CODE_V1 = `async function execute({ input, app }) {\n  const roots = app.roots();\n  if (!input.trim()) return { success: true, tool: "workspace", output: \`Approved Workspace Roots:\\n\${roots.map(r => r.path).join('\\n') || 'None configured'}\` };\n  const file = await app.readFile(input.trim());\n  return { success: true, tool: "workspace", output: \`File: \${file.path} (\${file.size} bytes):\\n\${file.content.slice(0, 500)}\` };\n}`;

const CODE_SKILL_CODE_V3 = `async function execute({ input, app }) {\n  const prompt = (input || '').trim();\n  if (!prompt) return { success: false, tool: "code", output: 'Usage: /code <description of what to generate>' };\n  const code = (await app.generate({ system: 'You write code. Reply with only the code for the request \\u2014 no explanation, no markdown code fences.', prompt })).trim();\n  return { success: true, tool: "code", output: code || 'The model returned no code.' };\n}`;

// The generated wrapper from an imported skills.sh record: escaped instruction
// prose returned verbatim, with no executable body of its own.
const IMPORT_WRAPPER_PREFIX = 'async function execute({ input }) {\n  const instructions = `';
const IMPORT_WRAPPER_SUFFIX = '`;\n  return { success: true, output: input ? `${instructions}\\n\\n---\\nRequested with: ${input}` : instructions };\n}';

const APPLICATION_SKILL_CODE = new Set([
  SEARCH_SKILL_CODE_V1, SEARCH_SKILL_CODE_V2,
  CODE_SKILL_CODE_V1, CODE_SKILL_CODE_V2, CODE_SKILL_CODE_V3,
  CALC_SKILL_CODE_V1, HARDWARE_SKILL_CODE_V2, MCP_SKILL_CODE_V2, WORKSPACE_SKILL_CODE_V1,
]);

export const MEMORY_IMPORTANCE = ['high', 'medium', 'low'];

function validImportance(value) {
  const importance = String(value ?? '').trim();
  if (!MEMORY_IMPORTANCE.includes(importance)) {
    const error = new Error(`Memory importance must be one of ${MEMORY_IMPORTANCE.join(', ')}.`);
    error.code = 'validation';
    throw error;
  }
  return importance;
}

export function skillProvenanceFor(code) {
  if (APPLICATION_SKILL_CODE.has(code)) return 'application';
  if (typeof code === 'string' && code.startsWith(IMPORT_WRAPPER_PREFIX) && code.endsWith(IMPORT_WRAPPER_SUFFIX)) return 'import_wrapper';
  return 'user_authored';
}

const boundedLimit = (raw) => {
  const parsed = Number.parseInt(raw ?? 50, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 50;
  return Math.min(parsed, 200);
};

const READ_MODELS = {
  conversation_counts: (db) => db.prepare('SELECT (SELECT COUNT(*) FROM conversations) AS conversations, (SELECT COUNT(*) FROM messages) AS messages').all(),
  recent_conversations: (db, limit) => db.prepare('SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC, id DESC LIMIT ?').all(limit),
  skill_summary: (db, limit) => db.prepare('SELECT id, name, slash_command, description, enabled, type, version, execution_provenance FROM skills ORDER BY type DESC, created_at DESC, id DESC LIMIT ?').all(limit),
  memory_summary: (db, limit) => db.prepare('SELECT id, category, key, value, importance, updated_at FROM memories ORDER BY updated_at DESC, id DESC LIMIT ?').all(limit),
  agent_run_summary: (db, limit) => db.prepare('SELECT id, agent_id, adapter, mode, status, effective_capabilities, started_at, completed_at FROM agent_runs ORDER BY started_at DESC, id DESC LIMIT ?').all(limit),
  mcp_server_summary: (db, limit) => db.prepare('SELECT id, name, type, status, latency_ms FROM mcp_servers ORDER BY created_at, id LIMIT ?').all(limit),
  workspace_roots: (db, limit) => db.prepare('SELECT id, path, added_at FROM workspace_roots ORDER BY added_at, id LIMIT ?').all(limit),
};


// SQLite and the key material that decrypts its provider credentials are one
// recoverable unit: credentials stored under a file-backed key cannot be read
// back if that file is left behind.
export function assertCredentialKeyAvailable(dataRoot) {
  const databaseFile = path.join(dataRoot, 'sql-db', 'jarvis.sqlite');
  if (!fs.existsSync(databaseFile)) return;
  if (process.env.JARVIS_KEY_SALT?.trim()) return;
  if (fs.existsSync(path.join(dataRoot, 'provider.key'))) return;

  const probe = new DatabaseSync(databaseFile);
  let encrypted = 0;
  try { encrypted = probe.prepare('SELECT COUNT(*) AS count FROM providers WHERE api_key_enc IS NOT NULL').get().count; }
  catch { return; }
  finally { probe.close(); }
  if (!encrypted) return;

  const error = new Error(`Provider credentials in ${databaseFile} cannot be read: set JARVIS_KEY_SALT, or restore provider.key beside the database.`);
  error.code = 'credential_key_missing';
  throw error;
}

export class JarvisDatabase {
  // A string argument names the database file and its directory owns the key
  // material; { dataRoot } derives both from the resolved runtime path set.
  constructor(options = {}) {
    const { dbPath, dataRoot } = typeof options === 'string' ? { dbPath: options, dataRoot: path.dirname(options) } : options;
    this.dataRoot = dataRoot || dataDirectory();
    this.dbPath = dbPath || path.join(this.dataRoot, 'sql-db', 'jarvis.sqlite');
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL, provider TEXT, status TEXT NOT NULL DEFAULT 'complete', created_at TEXT NOT NULL, origin TEXT);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'user_preference', key TEXT NOT NULL, value TEXT NOT NULL, importance TEXT NOT NULL DEFAULT 'medium' CHECK(importance IN ('high','medium','low')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'stdio', endpoint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown', latency_ms INTEGER, last_probe_at TEXT, failure_reason TEXT, tools_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, slash_command TEXT NOT NULL UNIQUE, description TEXT NOT NULL, code TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, type TEXT NOT NULL DEFAULT 'custom', author TEXT NOT NULL DEFAULT 'JARVIS Core', version TEXT NOT NULL DEFAULT '1.0.0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workspace_edits (id TEXT PRIMARY KEY, file_path TEXT NOT NULL, content TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending_review', created_at TEXT NOT NULL, reviewed_at TEXT);
CREATE TABLE IF NOT EXISTS agent_runs (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, agent_id TEXT NOT NULL, adapter TEXT NOT NULL, parent_run_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, objective TEXT NOT NULL, result TEXT, started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol TEXT NOT NULL, base_url TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', api_key_enc TEXT, tags TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 50, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS authorization_grants (id TEXT PRIMARY KEY, action TEXT NOT NULL, target TEXT NOT NULL, requested TEXT NOT NULL, issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT);
CREATE TABLE IF NOT EXISTS authorization_audit (id TEXT PRIMARY KEY, turn_id TEXT, origin TEXT, action TEXT NOT NULL, requested_target TEXT NOT NULL, granted_target TEXT, effective_target TEXT, outcome TEXT NOT NULL, created_at TEXT NOT NULL);`);
    const columns = this.db.prepare('PRAGMA table_info(messages)').all().map((column) => column.name);
    if (!columns.includes('origin')) this.db.exec('ALTER TABLE messages ADD COLUMN origin TEXT');

    const memCols = this.db.prepare('PRAGMA table_info(memories)').all().map((column) => column.name);
    if (!memCols.includes('category')) this.db.exec("ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT 'user_preference'");
    if (!memCols.includes('importance')) this.db.exec("ALTER TABLE memories ADD COLUMN importance TEXT NOT NULL DEFAULT 'medium'");
    if (!memCols.includes('updated_at')) this.db.exec("ALTER TABLE memories ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");

    const runCols = this.db.prepare('PRAGMA table_info(agent_runs)').all().map((column) => column.name);
    if (!runCols.includes('effective_capabilities')) this.db.exec("ALTER TABLE agent_runs ADD COLUMN effective_capabilities TEXT NOT NULL DEFAULT '[]'");

    const skillCols = this.db.prepare('PRAGMA table_info(skills)').all().map((column) => column.name);
    if (!skillCols.includes('execution_provenance')) {
      this.db.exec("ALTER TABLE skills ADD COLUMN execution_provenance TEXT NOT NULL DEFAULT 'user_authored'");
    }
    this.constrainMemoryImportance();
    this.relateAgentRunsToConversations();
    this.db.exec("UPDATE workspace_edits SET status='approved_and_applied' WHERE status='approved'");
    this.recordMcpObservations();
    this.correctSeededStackFact();
    // Each index serves one repeated filtered query, and covers that query's
    // ordering so it needs no sort of its own.
    this.db.exec(`
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conversation ON agent_runs(conversation_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_edits_status ON workspace_edits(status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category, updated_at DESC, id DESC);
`);
    this.seed();
    this.upgradeBuiltInSkills();
    this.classifySkillProvenance();
  }

  // Built-in skill upgrades require an exact registered-source match so user-edited
  // implementations remain untouched.
  upgradeBuiltInSkills() {
    const upgrades = [
      { id: 'skill-search', from: SEARCH_SKILL_CODE_V1, to: SEARCH_SKILL_CODE_V2, name: 'Workspace Search', description: 'Searches file names and contents across approved workspace roots.', version: '1.5.0' },
      { id: 'skill-code', from: CODE_SKILL_CODE_V1, to: CODE_SKILL_CODE_V2, name: 'Code Generator', description: 'Generates code from a natural-language prompt using the active model.', version: '1.1.0' },
      { id: 'skill-code', from: CODE_SKILL_CODE_V2, to: CODE_SKILL_CODE_V3, name: 'Code Generator', description: 'Generates code from a natural-language prompt using the active model.', version: '1.2.0' },
    ];
    for (const upgrade of upgrades) {
      const row = this.db.prepare('SELECT code, type FROM skills WHERE id=?').get(upgrade.id);
      if (!row || row.type !== 'built-in' || row.code !== upgrade.from) continue;
      this.db.prepare('UPDATE skills SET name=?, code=?, description=?, version=?, updated_at=? WHERE id=?')
        .run(upgrade.name, upgrade.to, upgrade.description, upgrade.version, now(), upgrade.id);
    }
  }
  tableSql(name) {
    return this.db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('table', name)?.sql || '';
  }

  // SQLite cannot add a constraint in place, so an existing table is rebuilt.
  // Both rebuilds are guarded on the constraint already being present.
  // The seeded stack fact reaches the model in every turn, so a database seeded
  // before it was corrected is updated in place. A row an operator has edited no
  // longer matches the seeded text and is left alone.
  correctSeededStackFact() {
    this.db.prepare('UPDATE memories SET value=?, updated_at=? WHERE id=? AND value=?')
      .run('Built with React 19, authored CSS, and Lucide icons; bundled by Vite.', now(), 'mem-3', 'Built with React 19, Tailwind CSS, Lucide icons, and Canvas particle effects.');
  }

  constrainMemoryImportance() {
    if (this.tableSql('memories').includes('CHECK(importance')) return;
    this.db.exec(`CREATE TABLE memories_constrained (id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'user_preference', key TEXT NOT NULL, value TEXT NOT NULL, importance TEXT NOT NULL DEFAULT 'medium' CHECK(importance IN ('high','medium','low')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO memories_constrained (id,category,key,value,importance,created_at,updated_at)
  SELECT id, category, key, value,
    CASE WHEN TRIM(COALESCE(importance,'')) IN ('high','medium','low') THEN TRIM(importance) ELSE 'medium' END,
    created_at, updated_at FROM memories;
DROP TABLE memories;
ALTER TABLE memories_constrained RENAME TO memories;`);
  }

  // Health is an observation. A row with no probe time cannot prove its status or
  // latency was ever measured, so it starts over as unknown.
  recordMcpObservations() {
    if (this.tableSql('mcp_servers').includes('last_probe_at')) return;
    this.db.exec(`CREATE TABLE mcp_servers_observed (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'stdio', endpoint TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown', latency_ms INTEGER, last_probe_at TEXT, failure_reason TEXT, tools_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO mcp_servers_observed (id,name,type,endpoint,status,latency_ms,last_probe_at,failure_reason,tools_json,created_at,updated_at)
  SELECT id, name, type, endpoint, 'unknown', NULL, NULL, NULL, tools_json, created_at, updated_at FROM mcp_servers;
DROP TABLE mcp_servers;
ALTER TABLE mcp_servers_observed RENAME TO mcp_servers;`);
  }

  // A run records work that happened, so it outlives the conversation it began in.
  relateAgentRunsToConversations() {
    if (this.tableSql('agent_runs').includes('REFERENCES conversations')) return;
    this.db.exec(`CREATE TABLE agent_runs_related (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL, agent_id TEXT NOT NULL, adapter TEXT NOT NULL, parent_run_id TEXT, mode TEXT NOT NULL, status TEXT NOT NULL, objective TEXT NOT NULL, result TEXT, started_at TEXT NOT NULL, completed_at TEXT, effective_capabilities TEXT NOT NULL DEFAULT '[]');
INSERT INTO agent_runs_related (id,conversation_id,agent_id,adapter,parent_run_id,mode,status,objective,result,started_at,completed_at,effective_capabilities)
  SELECT id,
    CASE WHEN conversation_id IN (SELECT id FROM conversations) THEN conversation_id ELSE NULL END,
    agent_id, adapter, parent_run_id, mode, status, objective, result, started_at, completed_at, effective_capabilities FROM agent_runs;
DROP TABLE agent_runs;
ALTER TABLE agent_runs_related RENAME TO agent_runs;`);
  }

  // Only an exact application-owned implementation is `application`, and only an
  // exact generated import wrapper is `import_wrapper`. Every other row, including
  // an edited built-in, is `user_authored`. Re-running converges to the same state.
  classifySkillProvenance() {
    const rows = this.db.prepare('SELECT id, code, execution_provenance FROM skills').all();
    const update = this.db.prepare('UPDATE skills SET execution_provenance=? WHERE id=?');
    for (const row of rows) {
      const provenance = skillProvenanceFor(row.code);
      if (provenance !== row.execution_provenance) update.run(provenance, row.id);
    }
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
          status: 'unknown',
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
          status: 'unknown',
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
          status: 'unknown',
          tools_json: JSON.stringify([
            { name: 'execute_query', description: 'Reads one named application read model. Parameters: model (a read-model name), limit (optional row cap).', parameters: 'model: string, limit?: string', readOnly: true }
          ]),
          created_at: now(),
          updated_at: now()
        }
      ];
      const stmt = this.db.prepare('INSERT INTO mcp_servers(id,name,type,endpoint,status,latency_ms,last_probe_at,failure_reason,tools_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,NULL,NULL,?,?,?)');
      for (const s of defaultMcp) stmt.run(s.id, s.name, s.type, s.endpoint, s.status, s.tools_json, s.created_at, s.updated_at);
    }

    const skillCount = this.db.prepare('SELECT COUNT(*) as count FROM skills').get().count;
    if (skillCount === 0) {
      const defaultSkills = [
        {
          id: 'skill-search',
          name: 'Workspace Search',
          slash_command: '/search',
          description: 'Searches file names and contents across approved workspace roots.',
          code: SEARCH_SKILL_CODE_V2,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.5.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-calc',
          name: 'Mathematical Evaluator',
          slash_command: '/calc',
          description: 'Safely evaluates mathematical and algebraic expressions.',
          code: CALC_SKILL_CODE_V1,
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
          code: HARDWARE_SKILL_CODE_V2,
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
          code: MCP_SKILL_CODE_V2,
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
          code: WORKSPACE_SKILL_CODE_V1,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.2.0',
          created_at: now(),
          updated_at: now()
        },
        {
          id: 'skill-code',
          name: 'Code Generator',
          slash_command: '/code',
          description: 'Generates code from a natural-language prompt using the active model.',
          code: CODE_SKILL_CODE_V3,
          enabled: 1,
          type: 'built-in',
          author: 'JARVIS Core',
          version: '1.2.0',
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
        { id: 'mem-3', category: 'code_context', key: 'Frontend UI System', value: 'Built with React 19, authored CSS, and Lucide icons; bundled by Vite.', importance: 'medium', created_at: now(), updated_at: now() },
        { id: 'mem-4', category: 'conversation_summary', key: 'Model Orchestration', value: 'Configured hardware-aware local model orchestration engine for dynamic cloud fallback.', importance: 'high', created_at: now(), updated_at: now() }
      ];
      const memStmt = this.db.prepare('INSERT INTO memories(id,category,key,value,importance,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
      for (const m of defaultMemories) memStmt.run(m.id, m.category, m.key, m.value, m.importance, m.created_at, m.updated_at);
    }
    this.seedProvidersFromEnv();
  }

  setting(key, fallback = null) { const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key); return row ? JSON.parse(row.value) : fallback; }
  setSetting(key, value) { this.db.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, JSON.stringify(value), now()); }

  // --- PROTECTED READ MODELS ---
  // The read-only SQLite capability selects a named model here instead of running
  // SQL. No model reaches providers, encrypted credential columns, settings, or
  // schema metadata.
  readModelNames() { return Object.keys(READ_MODELS); }
  readModel(name, params = {}) {
    const model = Object.prototype.hasOwnProperty.call(READ_MODELS, name) ? READ_MODELS[name] : null;
    if (!model) { const error = new Error(`Unknown read model "${name}". Available: ${Object.keys(READ_MODELS).join(', ')}.`); error.code = 'validation'; throw error; }
    return model(this.db, boundedLimit(params.limit));
  }

  // --- AUTHORIZATION GRANTS AND AUDIT ---
  issueGrant({ id, action, target, requested, expiresAt }) {
    const issuedAt = now();
    this.db.prepare('INSERT INTO authorization_grants(id,action,target,requested,issued_at,expires_at,consumed_at) VALUES(?,?,?,?,?,?,NULL)')
      .run(id, action, target, requested, issuedAt, expiresAt);
    return { id, action, target, issuedAt, expiresAt };
  }
  // Single use: the same statement that reads the grant retires it, so a replayed
  // id finds nothing to consume.
  consumeGrant(id, at) {
    const changes = this.db.prepare('UPDATE authorization_grants SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at > ?').run(at, id, at).changes;
    if (changes !== 1) return null;
    return this.db.prepare('SELECT id, action, target, requested, issued_at, expires_at, consumed_at FROM authorization_grants WHERE id=?').get(id);
  }
  recordAuthorization({ id, turnId, origin, action, requestedTarget, grantedTarget, effectiveTarget, outcome }) {
    this.db.prepare('INSERT INTO authorization_audit(id,turn_id,origin,action,requested_target,granted_target,effective_target,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, turnId, origin, action, requestedTarget, grantedTarget, effectiveTarget, outcome, now());
  }
  authorizationAudit(limit = 100) {
    return this.db.prepare('SELECT * FROM authorization_audit ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
  }
  conversations() { return this.db.prepare('SELECT * FROM conversations ORDER BY updated_at DESC, id DESC').all(); }
  conversation(id) { return this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id); }
  messages(conversationId) { return this.db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, id').all(conversationId); }
  createConversation(title = 'New conversation') { const item = { id: id(), title, created_at: now(), updated_at: now() }; this.db.prepare('INSERT INTO conversations VALUES(?,?,?,?)').run(item.id,item.title,item.created_at,item.updated_at); return item; }
  touchConversation(id, title) { this.db.prepare('UPDATE conversations SET title=COALESCE(?,title),updated_at=? WHERE id=?').run(title || null, now(), id); }
  deleteConversation(id) { this.db.prepare('DELETE FROM messages WHERE conversation_id=?').run(id); return this.db.prepare('DELETE FROM conversations WHERE id=?').run(id).changes > 0; }
  addMessage(conversationId, role, content, provider = null, status = 'complete', origin = null) { const item = { id: id(), conversation_id: conversationId, role, content, provider, status, created_at: now(), origin }; this.db.prepare('INSERT INTO messages(id,conversation_id,role,content,provider,status,created_at,origin) VALUES(?,?,?,?,?,?,?,?)').run(item.id,item.conversation_id,item.role,item.content,item.provider,item.status,item.created_at,item.origin); this.touchConversation(conversationId); return item; }
  roots() { return this.db.prepare('SELECT * FROM workspace_roots ORDER BY added_at, id').all(); }
  addRoot(rootPath) { const item = { id: id(), path: rootPath, added_at: now() }; this.db.prepare('INSERT INTO workspace_roots VALUES(?,?,?)').run(item.id,item.path,item.added_at); return item; }
  removeRoot(id) { return this.db.prepare('DELETE FROM workspace_roots WHERE id=?').run(id).changes > 0; }
  workspaceEdits(status) {
    if (status) return this.db.prepare('SELECT * FROM workspace_edits WHERE status=? ORDER BY created_at DESC, id DESC').all(status);
    return this.db.prepare('SELECT * FROM workspace_edits ORDER BY created_at DESC, id DESC').all();
  }
  proposeWorkspaceEdit(filePath, content, reason = 'Proposed code edit or self-evolution update') {
    const item = { id: `edit-${Date.now()}-${Math.floor(Math.random()*1000)}`, file_path: filePath, content, reason, status: 'pending_review', created_at: now(), reviewed_at: null };
    this.db.prepare('INSERT INTO workspace_edits VALUES(?,?,?,?,?,?,?)').run(item.id, item.file_path, item.content, item.reason, item.status, item.created_at, item.reviewed_at);
    return item;
  }
  workspaceEdit(id) {
    return this.db.prepare('SELECT * FROM workspace_edits WHERE id=?').get(id) || null;
  }
  // A reviewed edit is terminal; an illegal move is a conflict, not a silent no-op.
  updateWorkspaceEditStatus(id, status) {
    const existing = this.workspaceEdit(id);
    if (!existing) { const error = new Error(`Workspace edit "${id}" not found.`); error.code = 'not_found'; throw error; }
    if (!canTransition(existing.status, status)) {
      const error = new Error(`Workspace edit "${id}" is already ${existing.status}.`);
      error.code = 'conflict';
      throw error;
    }
    this.db.prepare('UPDATE workspace_edits SET status=?, reviewed_at=? WHERE id=?').run(status, now(), id);
    return this.workspaceEdit(id);
  }

  // --- MCP SERVERS METHOD ENGINE ---
  mcpServers() {
    const rows = this.db.prepare('SELECT * FROM mcp_servers ORDER BY created_at, id').all();
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      endpoint: r.endpoint,
      status: r.status,
      latencyMs: r.latency_ms,
      lastProbeAt: r.last_probe_at,
      failureReason: r.failure_reason,
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
      lastProbeAt: r.last_probe_at,
      failureReason: r.failure_reason,
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
      status: 'unknown',
      tools_json: JSON.stringify(tools),
      created_at: now(),
      updated_at: now()
    };
    this.db.prepare('INSERT INTO mcp_servers(id,name,type,endpoint,status,latency_ms,last_probe_at,failure_reason,tools_json,created_at,updated_at) VALUES(?,?,?,?,?,NULL,NULL,NULL,?,?,?)')
      .run(item.id, item.name, item.type, item.endpoint, item.status, item.tools_json, item.created_at, item.updated_at);
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
  // Only a completed probe writes here: success clears the failure reason,
  // failure keeps the elapsed time when one was measured.
  recordMcpProbe(id, { status, latencyMs = null, failureReason = null }) {
    this.db.prepare('UPDATE mcp_servers SET status=?, latency_ms=?, last_probe_at=?, failure_reason=?, updated_at=? WHERE id=?')
      .run(status, latencyMs, now(), status === 'connected' ? null : (failureReason || null)?.slice(0, 500) ?? null, now(), id);
    return this.mcpServer(id);
  }
  deleteMcpServer(id) {
    return this.db.prepare('DELETE FROM mcp_servers WHERE id=?').run(id).changes > 0;
  }

  // --- SLASH SKILLS METHOD ENGINE ---
  skills() {
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY type DESC, created_at DESC, id DESC').all();
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
      executionProvenance: r.execution_provenance,
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
      executionProvenance: r.execution_provenance,
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
      executionProvenance: r.execution_provenance,
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
    this.db.prepare('INSERT INTO skills(id,name,slash_command,description,code,enabled,type,author,version,created_at,updated_at,execution_provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(item.id, item.name, item.slash_command, item.description, item.code, item.enabled, item.type, item.author, item.version, item.created_at, item.updated_at, skillProvenanceFor(item.code));
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
    const provenance = code === existing.code ? existing.executionProvenance : skillProvenanceFor(code);
    this.db.prepare('UPDATE skills SET name=?, slash_command=?, description=?, code=?, enabled=?, updated_at=?, execution_provenance=? WHERE id=?')
      .run(name, slashCommand, description, code, enabled, updatedAt, provenance, id);
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
      return this.db.prepare('SELECT * FROM memories WHERE category=? ORDER BY updated_at DESC, id DESC').all(category);
    }
    return this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC, id DESC').all();
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
      importance: validImportance(importance),
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
    const importance = updates.importance === undefined ? existing.importance : validImportance(updates.importance);
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
  createAgentRun({ conversation_id = null, agent_id, adapter, parent_run_id = null, mode = 'solo', objective = '', effective_capabilities = [] }) {
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
      completed_at: null,
      effective_capabilities: JSON.stringify(effective_capabilities)
    };
    this.db.prepare('INSERT INTO agent_runs (id, conversation_id, agent_id, adapter, parent_run_id, mode, status, objective, result, started_at, completed_at, effective_capabilities) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(item.id, item.conversation_id, item.agent_id, item.adapter, item.parent_run_id, item.mode, item.status, item.objective, item.result, item.started_at, item.completed_at, item.effective_capabilities);
    return this.agentRun(item.id);
  }
  // Recorded run metadata names the adapter and capability set the run actually used.
  setAgentRunAuthority(runId, { adapter, effectiveCapabilities = [] }) {
    this.db.prepare('UPDATE agent_runs SET adapter=?, effective_capabilities=? WHERE id=?').run(adapter, JSON.stringify(effectiveCapabilities), runId);
    return this.agentRun(runId);
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
      return this.db.prepare('SELECT * FROM agent_runs WHERE conversation_id=? ORDER BY started_at DESC, id DESC').all(conversationId);
    }
    return this.db.prepare('SELECT * FROM agent_runs ORDER BY started_at DESC, id DESC LIMIT 100').all();
  }

  close() { this.db.close(); }

  // ---- PROVIDER REGISTRY ----
  providers() {
    return this.db.prepare('SELECT * FROM providers ORDER BY priority ASC, name ASC, id ASC').all()
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
      api_key_enc: api_key ? encryptKey(api_key, this.dataRoot) : null,
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
    const api_key_enc = updates.api_key ? encryptKey(updates.api_key, this.dataRoot) : existing._api_key_enc;
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
    try { return decryptKey(row.api_key_enc, this.dataRoot); } catch { return null; }
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
