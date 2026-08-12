import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { createApiRouter } from '../lib/api.mjs';
import express from 'express';

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

