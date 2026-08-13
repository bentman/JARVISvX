import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJarvisApp } from '../lib/application.mjs';
import { AgentRegistry } from '../lib/agents/registry.mjs';
import { PolicyGate } from '../lib/agents/policy.mjs';
import { ProcessAdapter } from '../lib/agents/adapters/process.mjs';
import { AcpAdapter } from '../lib/agents/adapters/acp.mjs';
import { AgentBusMcpServer } from '../lib/agents/agent-bus-mcp.mjs';
import { createApiRouter } from '../lib/api.mjs';

test('AgentRegistry loads built-in agent role profiles and CLI bindings', async () => {
  const registry = new AgentRegistry();
  await registry.load();
  const profiles = registry.list();
  
  assert.ok(profiles.length >= 7);
  const architect = registry.get('architect');
  assert.equal(architect.name, 'Architect (Claude Code)');
  assert.equal(architect.cli, 'claude');
  assert.equal(architect.voice, 'bm_george');
  assert.deepEqual(architect.capabilities, ['workspace.read', 'git.read']);

  const researcher = registry.get('researcher');
  assert.equal(researcher.cli, 'agy');

  const reviewer = registry.get('reviewer');
  assert.equal(reviewer.cli, 'codex');

  const security = registry.get('security');
  assert.equal(security.cli, 'copilot');

  const debuggerAgent = registry.get('debugger');
  assert.equal(debuggerAgent.cli, 'cline');
});

test('PolicyGate evaluates capability intersection and workspace boundary', () => {
  const policy = new PolicyGate();
  const res = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read', 'workspace.write', 'shell'] },
    requestedCapabilities: ['workspace.write', 'git.read']
  });

  assert.equal(res.allowed, true);
  assert.deepEqual(res.effectiveCapabilities, ['workspace.write']);
  assert.equal(res.requiresHumanApproval, true);

  const cwd = process.cwd();
  const isValidPath = policy.validateWorkspacePath(cwd, [cwd]);
  assert.equal(isValidPath, true);
});

test('Adapters probe status and generate tokens', async () => {
  const acp = new AcpAdapter();
  const processAdapter = new ProcessAdapter({
    getProvider: () => ({
      async *streamChat() {
        yield { type: 'token', value: 'Hello from ProcessAdapter' };
      }
    })
  });

  assert.equal((await acp.probe()).status, 'available');
  assert.equal((await processAdapter.probe()).status, 'available');

  const tokens = [];
  for await (const event of processAdapter.invoke({
    prompt: 'test prompt',
    agent: { id: 'architect', name: 'Architect', voice: 'bm_george', instructions: '', capabilities: [] }
  })) {
    if (event.type === 'token') tokens.push(event.value);
  }

  assert.ok(tokens.includes('Hello from ProcessAdapter'));
});

test('RunCoordinator executes solo, panel, and debate multi-agent runs', async () => {
  const app = createJarvisApp();
  await app.initialize();

  const soloRun = await app.executeAgentRun({
    agentId: 'architect',
    objective: 'Design a modular system',
    mode: 'solo'
  });
  assert.equal(soloRun.mode, 'solo');
  assert.equal(soloRun.status, 'completed');

  const panelRun = await app.executeAgentRun({
    agentIds: ['architect', 'reviewer'],
    objective: 'Evaluate architectural proposal',
    mode: 'panel'
  });
  assert.equal(panelRun.mode, 'panel');
  assert.equal(panelRun.status, 'completed');

  const debateRun = await app.executeAgentRun({
    agentIds: ['architect', 'reviewer', 'adversary'],
    objective: 'Should we replace SQLite with Postgres?',
    mode: 'debate'
  });
  assert.equal(debateRun.mode, 'debate');
  assert.equal(debateRun.status, 'completed');
  assert.ok(debateRun.result.includes('Debate Round 1'));
  assert.ok(debateRun.result.includes('Debate Round 2'));
  assert.ok(debateRun.result.includes('Final Synthesis'));

  app.db.close();
});

test('AgentBusMcpServer exposes agent tools and guards max delegation depth', async () => {
  const app = createJarvisApp();
  await app.initialize();

  const bus = new AgentBusMcpServer({ runtime: app.agentRuntime });
  const tools = bus.getTools();
  assert.ok(tools.some((t) => t.name === 'agents_list'));

  const listRes = await bus.executeTool('agents_list', {});
  assert.equal(listRes.success, true);
  assert.ok(listRes.agents.length >= 7);

  const depthExceeded = await bus.executeTool('agents_ask', {
    targetAgentId: 'reviewer',
    objective: 'Deep task',
    currentDepth: 3
  });
  assert.equal(depthExceeded.success, false);
  assert.ok(depthExceeded.error.includes('depth'));

  app.db.close();
});

test('API endpoints return agent list and execute agent run', async () => {
  const app = createJarvisApp();
  await app.initialize();

  const agents = app.agents();
  assert.ok(agents.length >= 7);

  const run = await app.executeAgentRun({
    agentId: 'reviewer',
    objective: 'Review code quality',
    mode: 'solo'
  });
  assert.equal(run.agent_id, 'reviewer');
  assert.equal(run.status, 'completed');

  app.db.close();
});
