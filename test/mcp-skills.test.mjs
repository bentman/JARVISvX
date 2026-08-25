import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { createApiRouter } from '../lib/api.mjs';
import express from 'express';

const stdioFixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-stdio-server.mjs');
const stdioCommand = `node "${stdioFixture}"`;

// chat() resolves its provider through one selection operation; tests stub that.
const useProvider = (app, provider) => {
  app.getProvider = () => provider;
  app.selectProvider = () => ({ provider, source: 'user', reason: `Test provider ${provider.id}` });
};

test('database seeds default MCP servers and skills', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-db-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');
  const db = new JarvisDatabase(dbPath);

  const servers = db.mcpServers();
  assert.ok(servers.length >= 3, 'Should seed at least 3 default MCP servers');
  const fsServer = servers.find((s) => s.id === 'mcp-fs');
  assert.ok(fsServer, 'mcp-fs server should exist');
  assert.equal(fsServer.name, 'Local File System MCP Server');

  const skills = db.skills();
  assert.ok(skills.length >= 6, 'Should seed at least 6 default slash skills');
  const calcSkill = skills.find((s) => s.slashCommand === '/calc');
  assert.ok(calcSkill, '/calc skill should exist');
  assert.equal(calcSkill.enabled, true);

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('MCP server CRUD operations work cleanly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-crud-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const newServer = db.addMcpServer({
    name: 'Test Database MCP',
    type: 'http',
    endpoint: 'http://127.0.0.1:9999/mcp',
    tools: [{ name: 'db_query', description: 'Run test DB query' }]
  });
  assert.ok(newServer.id, 'New server should have ID');
  assert.equal(newServer.name, 'Test Database MCP');

  const updated = db.updateMcpServer(newServer.id, { name: 'Updated DB MCP', status: 'error' });
  assert.equal(updated.name, 'Updated DB MCP');
  assert.equal(updated.status, 'error');

  const deleted = db.deleteMcpServer(newServer.id);
  assert.equal(deleted, true);
  assert.equal(db.mcpServer(newServer.id), null);

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('Skills CRUD and toggle operations work cleanly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-skill-crud-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));

  const newSkill = db.addSkill({
    name: 'Echo Skill',
    slashCommand: '/echo',
    description: 'Echoes back the input',
    code: 'async function execute({ input }) { return { output: input }; }',
    enabled: true
  });

  assert.equal(newSkill.slashCommand, '/echo');
  assert.equal(db.skillByCommand('/echo').name, 'Echo Skill');

  const toggled = db.toggleSkill(newSkill.id);
  assert.equal(toggled.enabled, false);

  const updated = db.updateSkill(newSkill.id, { description: 'Updated echo description' });
  assert.equal(updated.description, 'Updated echo description');

  const deleted = db.deleteSkill(newSkill.id);
  assert.equal(deleted, true);
  assert.equal(db.skillByCommand('/echo'), null);

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('app executes real workspace tools and math skill', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-app-tools-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();

  // Test math skill execution
  const calcRes = await app.executeSkill('/calc', '100 / 4 + 5');
  assert.equal(calcRes.success, true);
  assert.ok(calcRes.output.includes('Math Result: 100 / 4 + 5 = 30'));

  // Test workspace file creation and tool execution
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-root-'));
  await app.addRoot(rootDir);

  const fsServer = db.mcpServer('mcp-fs');
  const writeRes = await app.executeMcpTool(fsServer.id, 'write_workspace_file', {
    path: path.join(rootDir, 'test.txt'),
    content: 'Hello World MCP'
  });
  assert.equal(writeRes.success, true);

  const readRes = await app.executeMcpTool(fsServer.id, 'read_workspace_file', {
    path: path.join(rootDir, 'test.txt')
  });
  assert.equal(readRes.success, true);
  assert.equal(readRes.output, 'Hello World MCP');

  const listRes = await app.executeMcpTool(fsServer.id, 'list_workspace_directory', {});
  assert.equal(listRes.success, true);
  assert.ok(listRes.output.includes('test.txt'));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('/search performs a real search across approved workspace roots, not a canned reply', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-search-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-search-root-'));
  await app.addRoot(rootDir);
  fs.writeFileSync(path.join(rootDir, 'notes.txt'), 'first line\nthe secret ingredient is nutmeg\nlast line');

  const found = await app.executeSkill('/search', 'nutmeg');
  assert.equal(found.success, true);
  assert.ok(found.output.includes('notes.txt:2'), 'should report the real matching file and line number');
  assert.ok(found.output.includes('secret ingredient is nutmeg'));
  assert.ok(!found.output.includes('Retrieved live search grounding'), 'the old canned stub reply should be gone');

  const notFound = await app.executeSkill('/search', 'no-such-term-anywhere-xyz');
  assert.equal(notFound.success, true);
  assert.ok(notFound.output.includes('No matches for'));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
  fs.rmSync(rootDir, { recursive: true, force: true });
});

test('/code asks the active provider to generate real code, not a fixed template', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-code-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();

  let receivedPrompt = null;
  useProvider(app, {
    id: 'fake-coder', label: 'Fake coder', model: 'fake-model',
    async listModels() { return ['fake-model']; },
    async *streamChat({ messages }) {
      receivedPrompt = messages.find((m) => m.role === 'user')?.content;
      yield 'function add(a, b) {';
      yield ' return a + b; }';
    },
  });

  const result = await app.executeSkill('/code', 'a function that adds two numbers');
  assert.equal(result.success, true);
  assert.equal(receivedPrompt, 'a function that adds two numbers');
  assert.equal(result.output, 'function add(a, b) { return a + b; }');
  assert.ok(!result.output.includes('Evolved Subroutine'), 'the old canned template reply should be gone');

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('stdio MCP servers: adding one discovers real tools, and executing a tool runs the real process', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-stdio-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();

  const server = await app.addMcpServer({ name: 'Fixture Stdio Server', type: 'stdio', endpoint: stdioCommand });
  assert.ok(server.tools.some((t) => t.name === 'echo'), 'the server\'s real declared tools should be discovered, not a placeholder "execute" tool');

  const ping = await app.pingMcpServer(server.id);
  assert.equal(ping.status, 'connected');

  const result = await app.executeMcpTool(server.id, 'echo', { text: 'hello stdio' });
  assert.equal(result.success, true);
  assert.equal(result.output, 'echo: hello stdio');

  const failed = await app.executeMcpTool(server.id, 'boom', {});
  assert.equal(failed.success, false);
  assert.ok(failed.error.includes('boom failed on purpose'));

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('adding an SSE MCP server is rejected instead of silently accepted with no working transport', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-sse-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();

  await assert.rejects(
    app.addMcpServer({ name: 'Unsupported SSE Server', type: 'sse', endpoint: 'http://127.0.0.1:9999/sse' }),
    /not implemented/
  );

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('executeMcpTool reports a clear failure instead of a fake success for a server type with no execution path', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-unknown-type-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const app = createJarvisApp({ database: db });
  await app.initialize();
  // Direct insertion models persisted data whose transport has no execution path.
  const server = db.addMcpServer({ name: 'Unknown Transport', type: 'carrier-pigeon', endpoint: 'pigeon://loft', tools: [{ name: 'send_message', description: 'x' }] });

  const result = await app.executeMcpTool(server.id, 'send_message', {});
  assert.equal(result.success, false);
  assert.ok(result.error.includes('No execution path'));
  assert.ok(!result.output.includes('Executed tool'), 'should not claim the tool ran when nothing actually executed');

  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('upgradeBuiltInSkills replaces an untouched stub /search or /code row but leaves a user-customized one alone', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-skill-upgrade-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');

  // Seed registered upgrade-source code and a user-customized implementation.
  const oldStubSearch = 'async function execute({ input, app }) {\n  return { success: true, tool: "search", output: `Retrieved live search grounding for: "${input}"` };\n}';
  {
    const db = new JarvisDatabase(dbPath);
    db.db.prepare('UPDATE skills SET code=? WHERE id=?').run(oldStubSearch, 'skill-search');
    db.db.prepare('UPDATE skills SET code=? WHERE id=?').run('async function execute({ input }) { return { success: true, tool: "code", output: `mine: ${input}` }; }', 'skill-code');
    db.close();
  }

  // Reopening applies the recognized upgrade and preserves customized code.
  const db2 = new JarvisDatabase(dbPath);
  const search = db2.skill('skill-search');
  assert.ok(!search.code.includes('Retrieved live search grounding'), '/search should be upgraded to the real implementation');
  assert.ok(search.code.includes('app.searchWorkspace'));

  const code = db2.skill('skill-code');
  assert.ok(code.code.includes('mine: ${input}'), 'a customized built-in skill should not be overwritten');

  db2.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

// --- HTTP MCP transport ---

async function withHttpMcp(handler, run) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => handler(JSON.parse(raw || '{}'), res));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/mcp`); } finally { server.close(); }
}

const rpc = (res, body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };

test('an HTTP MCP call carries a request id and surfaces protocol failures as failed results', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-http-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  try {
    const app = createJarvisApp({ database: db });

    let seenId;
    await withHttpMcp((body, res) => {
      seenId = body.id;
      if (body.params?.name === 'ok') return rpc(res, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'done' }] } });
      if (body.params?.name === 'rpc-error') return rpc(res, { jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'server refused' } });
      if (body.params?.name === 'not-json') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>'); }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{}');
    }, async (endpoint) => {
      const server = db.addMcpServer({ name: 'HTTP MCP', type: 'http', endpoint, tools: [] });

      const ok = await app.executeMcpTool(server.id, 'ok', {});
      assert.equal(ok.success, true);
      assert.equal(ok.output, 'done');
      assert.ok(seenId, 'the call carries a JSON-RPC request id');

      const rpcError = await app.executeMcpTool(server.id, 'rpc-error', {});
      assert.equal(rpcError.success, false, 'a JSON-RPC error is a failed capability result');
      assert.match(rpcError.error, /server refused/);

      assert.equal((await app.executeMcpTool(server.id, 'not-json', {})).success, false, 'a non-JSON answer fails');
      assert.equal((await app.executeMcpTool(server.id, 'http-500', {})).success, false, 'an HTTP failure fails');
    });
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a probe records the health it measured, and registration alone records none', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-probe-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  try {
    const app = createJarvisApp({ database: db });

    await withHttpMcp((body, res) => rpc(res, { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2024-11-05' } }), async (endpoint) => {
      const registered = db.addMcpServer({ name: 'HTTP MCP', type: 'http', endpoint, tools: [] });
      assert.equal(registered.status, 'unknown', 'registering is not an observation');
      assert.equal(registered.latencyMs, null);
      assert.equal(registered.lastProbeAt, null);

      const probe = await app.pingMcpServer(registered.id);
      assert.equal(probe.status, 'connected');
      const stored = db.mcpServer(registered.id);
      assert.equal(stored.status, 'connected');
      assert.equal(typeof stored.latencyMs, 'number');
      assert.ok(stored.lastProbeAt, 'a completed probe records when it happened');
      assert.equal(stored.failureReason, null);
    });

    // An endpoint that is not listening is a measured failure with a reason.
    const dead = db.addMcpServer({ name: 'Dead', type: 'http', endpoint: 'http://127.0.0.1:1/mcp', tools: [] });
    const failed = await app.pingMcpServer(dead.id);
    assert.equal(failed.status, 'error');
    assert.ok(db.mcpServer(dead.id).failureReason, 'the failure reason is persisted');
    assert.ok(db.mcpServer(dead.id).lastProbeAt);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('MCP rows without a recorded probe migrate to unknown health', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mcp-migrate-'));
  const dbPath = path.join(directory, 'jarvis.sqlite');

  const legacy = new DatabaseSync(dbPath);
  legacy.exec(`CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT ('stdio'), endpoint TEXT NOT NULL, status TEXT NOT NULL DEFAULT ('connected'), latency_ms INTEGER NOT NULL DEFAULT 0, tools_json TEXT NOT NULL DEFAULT ('[]'), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO mcp_servers VALUES ('legacy','Legacy','http','http://127.0.0.1:1/mcp','connected',7,'[]','n','n');`);
  legacy.close();

  try {
    const db = new JarvisDatabase(dbPath);
    const migrated = db.mcpServer('legacy');
    assert.equal(migrated.status, 'unknown', 'a status with no probe time was never observed');
    assert.equal(migrated.latencyMs, null, 'and neither was its latency');
    assert.equal(migrated.lastProbeAt, null);
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
