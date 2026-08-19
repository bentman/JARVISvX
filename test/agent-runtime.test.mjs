import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createJarvisApp } from '../lib/application.mjs';
import { AgentRegistry } from '../lib/agents/registry.mjs';
import { PolicyGate } from '../lib/agents/policy.mjs';
import { ProcessAdapter } from '../lib/agents/adapters/process.mjs';
import { AcpAdapter } from '../lib/agents/adapters/acp.mjs';
import { AgentBusMcpServer } from '../lib/agents/agent-bus-mcp.mjs';
import { JarvisDatabase } from '../lib/database.mjs';

function createTestApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-runtime-'));
  const app = createJarvisApp({ database: new JarvisDatabase(path.join(directory, 'jarvis.sqlite')) });
  app.voice.bootstrap = {
    async install(id) {
      return { id, ready: true };
    },
    async status() {
      return [
        { id: 'wake.hey-jarvis', ready: true },
        { id: 'stt.whisper-base-en', ready: true },
        { id: 'tts.kokoro-v1', ready: true },
        { id: 'vad.silero-v6', ready: true }
      ];
    }
  };
  return {
    app,
    cleanup() {
      try { app.db.close(); } catch {}
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

function useDeterministicProcessAgents(app, ids = ['architect', 'reviewer', 'adversary']) {
  for (const id of ids) {
    const agent = app.agentRuntime.registry.get(id);
    app.agentRuntime.registry.profiles.set(id, { ...agent, adapter: 'process', capabilities: ['workspace.read'] });
  }
  app.agentRuntime.adapters.set('process', {
    async *invoke({ agent, prompt, runId }) {
      yield {
        type: 'token',
        runId,
        agentId: agent.id,
        speaker: { name: agent.name, voice: agent.voice },
        value: `${agent.id}: ${prompt}`
      };
      yield { type: 'completed', runId, agentId: agent.id };
    }
  });
}

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

  // Test allowed execution with approved privileged capability
  const res = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read', 'workspace.write', 'shell'] },
    requestedCapabilities: ['workspace.write'],
    approved: true
  });

  assert.equal(res.allowed, true);
  assert.deepEqual(res.effectiveCapabilities, ['workspace.write']);

  // Test policy rejection when agent lacks required capability
  const missingRes = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read'] },
    requestedCapabilities: ['workspace.write']
  });
  assert.equal(missingRes.allowed, false);
  assert.equal(missingRes.requiresHumanApproval, false);

  // Test approval requirement for privileged write/shell capabilities
  const unapprovedRes = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read', 'workspace.write'] },
    requestedCapabilities: ['workspace.write'],
    approved: false
  });
  assert.equal(unapprovedRes.allowed, false);
  assert.equal(unapprovedRes.requiresHumanApproval, true);

  const cwd = process.cwd();
  const isValidPath = policy.validateWorkspacePath(cwd, [cwd]);
  assert.equal(isValidPath, true);
});

test('Adapters probe status and generate tokens', async () => {
  const acp = new AcpAdapter();
  const processAdapter = new ProcessAdapter({
    getProvider: () => ({
      async *streamChat() {
        yield 'Hello from ProcessAdapter';
        yield { type: 'token', value: ' with object token compatibility' };
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

  assert.deepEqual(tokens, ['Hello from ProcessAdapter', ' with object token compatibility']);
});

// Finding 6 (docs/tech-debt-fragmentation-audit.md): ProcessAdapter.invoke() calls
// getProvider() directly, bypassing chat()'s cloud-tag + allowCloud gate entirely — a
// real, reachable path for an agent run to hit a cloud-tagged provider with zero user
// approval. These two tests prove the gate that closes it, both in isolation and
// threaded through the full executeAgentRun -> coordinator -> adapter call chain.
test('ProcessAdapter blocks a cloud-tagged provider without allowCloud, and permits it with allowCloud', async () => {
  const cloudProvider = {
    tags: ['cloud'],
    async *streamChat() { yield 'should never stream without approval'; }
  };
  const processAdapter = new ProcessAdapter({ getProvider: () => cloudProvider });
  const agent = { id: 'researcher', name: 'Researcher', voice: 'af_sarah', instructions: '', capabilities: [] };

  const blocked = [];
  for await (const event of processAdapter.invoke({ prompt: 'test', agent, runId: 'run-1' })) blocked.push(event);
  assert.deepEqual(blocked.map((e) => e.type), ['failed']);
  assert.equal(blocked[0].code, 'cloud_approval_required');
  assert.match(blocked[0].error, /explicit approval/);

  const approved = [];
  for await (const event of processAdapter.invoke({ prompt: 'test', agent, runId: 'run-2', allowCloud: true })) approved.push(event);
  assert.ok(approved.some((e) => e.type === 'token' && e.value.includes('should never stream without approval')));
  assert.ok(approved.some((e) => e.type === 'completed'));
});

test('executeAgentRun threads allowCloud from the API options through to the adapter', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  const agent = app.agentRuntime.registry.get('researcher');
  app.agentRuntime.registry.profiles.set('researcher', { ...agent, adapter: 'process', capabilities: ['workspace.read'] });
  let receivedAllowCloud;
  app.agentRuntime.adapters.set('process', {
    async *invoke({ agent, runId, allowCloud }) {
      receivedAllowCloud = allowCloud;
      yield { type: 'token', runId, agentId: agent.id, value: 'ok' };
      yield { type: 'completed', runId, agentId: agent.id };
    }
  });

  try {
    await app.executeAgentRun({ agentId: 'researcher', objective: 'test', mode: 'solo', allowCloud: true });
    assert.equal(receivedAllowCloud, true);

    await app.executeAgentRun({ agentId: 'researcher', objective: 'test', mode: 'solo' });
    assert.equal(receivedAllowCloud, false);
  } finally {
    cleanup();
  }
});

test('AcpAdapter reports missing CLI as a failed event', async () => {
  const acp = new AcpAdapter();
  const events = [];

  for await (const event of acp.invoke({
    prompt: 'ping',
    runId: 'run-1',
    agent: {
      id: 'missing',
      name: 'Missing CLI',
      voice: 'bf_isabella',
      instructions: '',
      capabilities: ['workspace.read'],
      command: 'definitely_missing_jarvisvx_cli'
    }
  })) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'failed');
  assert.match(events[0].error, /not available on PATH|ENOENT/);
});

test('RunCoordinator executes solo, panel, and debate multi-agent runs', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  useDeterministicProcessAgents(app);

  try {
    const soloRun = await app.executeAgentRun({
      agentId: 'architect',
      objective: 'Design a modular system',
      mode: 'solo'
    });
    assert.equal(soloRun.mode, 'solo');
    assert.equal(soloRun.status, 'completed');
    assert.match(soloRun.result, /architect: Design a modular system/);

    const panelRun = await app.executeAgentRun({
      agentIds: ['architect', 'reviewer'],
      objective: 'Evaluate architectural proposal',
      mode: 'panel'
    });
    assert.equal(panelRun.mode, 'panel');
    assert.equal(panelRun.status, 'completed');
    assert.match(panelRun.result, /architect: Objective: Evaluate architectural proposal/);
    assert.match(panelRun.result, /reviewer: Objective: Evaluate architectural proposal/);

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
  } finally {
    cleanup();
  }
});

test('RunCoordinator fails runs when an adapter produces no output', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  const agent = app.agentRuntime.registry.get('architect');
  app.agentRuntime.registry.profiles.set('architect', { ...agent, adapter: 'empty', capabilities: ['workspace.read'] });
  app.agentRuntime.adapters.set('empty', {
    async *invoke({ runId, agent }) {
      yield { type: 'completed', runId, agentId: agent.id };
    }
  });

  try {
    await assert.rejects(
      app.executeAgentRun({ agentId: 'architect', objective: 'Say READY', mode: 'solo' }),
      /completed without producing output/
    );
    const [run] = app.agentRuns();
    assert.equal(run.status, 'failed');
    assert.match(run.result, /completed without producing output/);
  } finally {
    cleanup();
  }
});

test('RunCoordinator applies policy to panel and debate agents', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  const builder = app.agentRuntime.registry.get('builder');
  app.agentRuntime.registry.profiles.set('builder', { ...builder, adapter: 'process' });
  app.agentRuntime.adapters.set('process', {
    async *invoke({ agent, prompt, runId }) {
      yield {
        type: 'token',
        runId,
        agentId: agent.id,
        speaker: { name: agent.name, voice: agent.voice },
        value: `${agent.id}: ${prompt}`
      };
      yield { type: 'completed', runId, agentId: agent.id };
    }
  });

  try {
    await assert.rejects(
      app.executeAgentRun({ agentIds: ['builder'], objective: 'Change files', mode: 'panel' }),
      /Policy Rejected/
    );
    await assert.rejects(
      app.executeAgentRun({ agentIds: ['builder'], objective: 'Change files', mode: 'debate' }),
      /Policy Rejected/
    );
  } finally {
    cleanup();
  }
});

test('AgentBusMcpServer exposes agent tools and guards max delegation depth', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();

  try {
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
  } finally {
    cleanup();
  }
});

test('API endpoints return agent list and execute agent run', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  useDeterministicProcessAgents(app, ['reviewer']);

  try {
    const agents = app.agents();
    assert.ok(agents.length >= 7);

    const run = await app.executeAgentRun({
      agentId: 'reviewer',
      objective: 'Review code quality',
      mode: 'solo'
    });
    assert.equal(run.agent_id, 'reviewer');
    assert.equal(run.status, 'completed');
    assert.match(run.result, /reviewer: Review code quality/);
  } finally {
    cleanup();
  }
});

// --- agents_send: a real follow-up-message delivery, not a canned "delivered" ---

test('AcpAdapter.send writes to a still-running interactive process, and fails honestly once it has exited', async () => {
  const acp = new AcpAdapter();
  const child = spawn(process.execPath, ['-e', "process.stdin.on('data', c => process.stdout.write('got:' + c))"], { stdio: ['pipe', 'pipe', 'ignore'] });
  acp.runs.set('run-live', child);

  let stdoutData = '';
  child.stdout.on('data', (chunk) => { stdoutData += chunk.toString(); });

  const sent = acp.send('run-live', 'hello agent');
  assert.equal(sent.success, true);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.ok(stdoutData.includes('got:hello agent'), 'the message should actually have reached the process');

  child.kill();
  await new Promise((resolve) => child.on('exit', resolve));

  const afterExit = acp.send('run-live', 'too late');
  assert.equal(afterExit.success, false);
  assert.match(afterExit.error, /no active process/);

  const unknown = acp.send('does-not-exist', 'msg');
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /no active process/);
});

test('AcpAdapter.send fails honestly for a one-shot process with no interactive stdin', () => {
  const acp = new AcpAdapter();
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2000)'], { stdio: ['ignore', 'ignore', 'ignore'] });
  acp.runs.set('run-oneshot', child);

  const result = acp.send('run-oneshot', 'hello');
  assert.equal(result.success, false);
  assert.match(result.error, /interactive mode/);

  child.kill();
});

test('AgentRuntime.sendToRun delivers to a live run, and fails honestly for unknown, completed, or non-interactive runs', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  try {
    const missing = app.agentRuntime.sendToRun('does-not-exist', 'hi');
    assert.equal(missing.success, false);
    assert.match(missing.error, /No agent run found/);

    const processRun = app.db.createAgentRun({ agent_id: 'researcher', adapter: 'process', mode: 'solo', objective: 'test' });
    const noSend = app.agentRuntime.sendToRun(processRun.id, 'hi');
    assert.equal(noSend.success, false);
    assert.match(noSend.error, /does not support sending/);

    const doneRun = app.db.createAgentRun({ agent_id: 'architect', adapter: 'acp', mode: 'solo', objective: 'test' });
    app.db.updateAgentRun(doneRun.id, { status: 'completed', result: 'ok' });
    const tooLate = app.agentRuntime.sendToRun(doneRun.id, 'hi');
    assert.equal(tooLate.success, false);
    assert.match(tooLate.error, /already completed/);

    const liveRun = app.db.createAgentRun({ agent_id: 'architect', adapter: 'acp', mode: 'solo', objective: 'test' });
    const child = spawn(process.execPath, ['-e', "process.stdin.on('data', c => process.stdout.write('got:' + c))"], { stdio: ['pipe', 'pipe', 'ignore'] });
    app.agentRuntime.adapters.get('acp').runs.set(liveRun.id, child);
    const sent = app.agentRuntime.sendToRun(liveRun.id, 'follow up');
    assert.equal(sent.success, true);
    child.kill();
  } finally {
    cleanup();
  }
});

test('AgentBusMcpServer.agents_send delegates to AgentRuntime.sendToRun instead of always reporting delivered', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  try {
    const bus = new AgentBusMcpServer({ runtime: app.agentRuntime });
    const missing = await bus.executeTool('agents_send', { runId: 'does-not-exist', message: 'hi' });
    assert.equal(missing.success, false);
    assert.match(missing.error, /No agent run found/);
  } finally {
    cleanup();
  }
});
