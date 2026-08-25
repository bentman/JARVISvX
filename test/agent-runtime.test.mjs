import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import { createJarvisApp } from '../lib/application.mjs';
import { AgentRegistry } from '../lib/agents/registry.mjs';
import { PROJECT_ROOT } from '../lib/runtime-paths.mjs';
import { PolicyGate } from '../lib/agents/policy.mjs';
import { createTurnAuthorization } from '../lib/authorization.mjs';
import { ProcessAdapter } from '../lib/agents/adapters/process.mjs';
import { AcpAdapter } from '../lib/agents/adapters/acp.mjs';
import { AgentBusMcpServer } from '../lib/agents/agent-bus-mcp.mjs';
import { JarvisDatabase } from '../lib/database.mjs';

// Grants come from the daemon ledger, the same path a client request takes.
const approve = (app, ...requests) => app.authorizationFor(requests.map((request) => app.issueApproval(request).id));

function createTestApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-runtime-'));
  const app = createJarvisApp({ database: new JarvisDatabase(path.join(directory, 'jarvis.sqlite')) });
  // Agent runs need an approved root to use as their working directory.
  app.db.addRoot(fs.realpathSync(directory));
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
  await withScratchConfig(async ({ configPath }) => {
    const registry = new AgentRegistry({ configPath });
    await registry.load();
    const profiles = registry.list();

    assert.ok(profiles.length >= 7);
    const architect = registry.get('architect');
    assert.equal(architect.name, 'Architect');
    assert.equal(architect.cli, 'claude');
    assert.equal(architect.voice, 'bm_george');
    assert.deepEqual(architect.capabilities, ['workspace.read', 'git.read']);

    assert.equal(registry.get('researcher').cli, 'agy');
    assert.equal(registry.get('reviewer').cli, 'codex');
    assert.equal(registry.get('security').cli, 'copilot');
    assert.equal(registry.get('debugger').cli, 'cline');
  });
});

// Registry mutation tests write to their own override path.
async function withScratchConfig(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agent-registry-'));
  const configPath = path.join(dir, 'agents.json');
  try {
    await fn({ dir, configPath });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('overrides seeded beside the source tree are adopted once into the runtime location', async () => {
  await withScratchConfig(async ({ configPath }) => {
    const seedPath = path.join(PROJECT_ROOT, '.jarvis', 'agents.json');
    const seedBefore = fs.readFileSync(seedPath, 'utf8');

    const registry = new AgentRegistry({ configPath });
    await registry.load();
    assert.ok(fs.existsSync(configPath), 'the seeded overrides land at the runtime location');
    assert.equal(fs.readFileSync(seedPath, 'utf8'), seedBefore, 'the seed is read, never rewritten');

    // A later edit is the only thing that changes the adopted file.
    await registry.updateAgent('architect', { voice: 'af_sarah' });
    const adopted = fs.readFileSync(configPath, 'utf8');
    await registry.load();
    assert.equal(fs.readFileSync(configPath, 'utf8'), adopted, 'adoption does not run again over saved profiles');
    assert.equal(registry.get('architect').voice, 'af_sarah');
  });
});

test('AgentRegistry.createAgent adds a real, persisted custom agent with a unique slugified id', async () => {
  await withScratchConfig(async ({ configPath }) => {
    const registry = new AgentRegistry({ configPath });
    await registry.load();

    const created = await registry.createAgent({
      name: 'QA Runner',
      description: 'Runs the test suite and reports failures.',
      adapter: 'acp',
      cli: 'claude',
      voice: 'af_bella',
      capabilities: ['workspace.read', 'shell'],
      instructions: 'Run tests, report only real failures.'
    });

    assert.equal(created.id, 'qa-runner');
    assert.equal(created.isBuiltIn, false);
    assert.deepEqual(registry.get('qa-runner').capabilities, ['workspace.read', 'shell']);

    const reloaded = new AgentRegistry({ configPath });
    await reloaded.load();
    assert.equal(reloaded.get('qa-runner').name, 'QA Runner');

    const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(onDisk.agents['qa-runner'].name, 'QA Runner');

    // A second agent with a colliding slug gets a disambiguated id.
    const dup = await registry.createAgent({ name: 'QA Runner', cli: 'claude', instructions: 'second one' });
    assert.equal(dup.id, 'qa-runner-2');
  });
});

test('AgentRegistry.createAgent rejects invalid fields instead of silently accepting them', async () => {
  await withScratchConfig(async ({ configPath }) => {
    const registry = new AgentRegistry({ configPath });
    await registry.load();

    await assert.rejects(registry.createAgent({ name: '' }), /name is required/);
    await assert.rejects(registry.createAgent({ name: 'x'.repeat(25) }), /24 characters or fewer/);
    await assert.rejects(registry.createAgent({ name: 'Too Long Instructions', instructions: 'x'.repeat(256) }), /255 characters or fewer/);
    await assert.rejects(registry.createAgent({ name: 'Bad Adapter', adapter: 'telepathy' }), /Unknown adapter/);
    await assert.rejects(registry.createAgent({ name: 'Bad CLI', adapter: 'acp', cli: 'gpt5-cli' }), /Unknown CLI/);
    await assert.rejects(registry.createAgent({ name: 'Bad Caps', capabilities: ['sudo'] }), /Unknown capabilit/);
    await assert.rejects(registry.createAgent({ name: 'No CLI', adapter: 'acp', cli: null }), /needs a CLI selected/);
  });
});

test('AgentRegistry.updateAgent restricts built-in agents to wiring fields only, and persists changes for both built-in and custom agents', async () => {
  await withScratchConfig(async ({ configPath }) => {
    const registry = new AgentRegistry({ configPath });
    await registry.load();

    // Built-in: adapter/cli/voice/capabilities may change...
    const updated = await registry.updateAgent('architect', { cli: 'codex', voice: 'af_sarah' });
    assert.equal(updated.cli, 'codex');
    assert.equal(updated.command, 'codex');
    assert.equal(updated.voice, 'af_sarah');
    assert.equal(updated.name, 'Architect'); // identity unchanged

    // ...but name/instructions are locked.
    await assert.rejects(registry.updateAgent('architect', { name: 'New Name' }), /built-in role/);
    await assert.rejects(registry.updateAgent('architect', { instructions: 'new instructions' }), /built-in role/);

    // The override survives a fresh load from disk.
    const reloaded = new AgentRegistry({ configPath });
    await reloaded.load();
    assert.equal(reloaded.get('architect').cli, 'codex');

    // Custom agents can have every field edited, including name/instructions.
    const custom = await registry.createAgent({ name: 'Scout', cli: 'claude', instructions: 'look around' });
    const editedCustom = await registry.updateAgent(custom.id, { name: 'Scout Prime', instructions: 'look far around' });
    assert.equal(editedCustom.name, 'Scout Prime');
    assert.equal(editedCustom.instructions, 'look far around');

    // Unknown agent id fails with a 404-flavored error.
    await assert.rejects(registry.updateAgent('does-not-exist', { voice: 'af_bella' }), (err) => err.code === 'not_found');
  });
});

test('AgentRegistry.deleteAgent removes custom agents but refuses to remove built-ins', async () => {
  await withScratchConfig(async ({ configPath }) => {
    const registry = new AgentRegistry({ configPath });
    await registry.load();

    const custom = await registry.createAgent({ name: 'Temp Agent', cli: 'claude', instructions: 'temporary' });
    assert.ok(registry.get(custom.id));

    const result = await registry.deleteAgent(custom.id);
    assert.equal(result.removed, true);
    assert.equal(registry.get(custom.id), null);

    await assert.rejects(registry.deleteAgent('architect'), /built-in role and cannot be deleted/);
    await assert.rejects(registry.deleteAgent('never-existed'), (err) => err.code === 'not_found');
  });
});

test('PolicyGate evaluates capability intersection and workspace boundary', async () => {
  const policy = new PolicyGate();
  const granted = createTurnAuthorization({ grants: [{ action: 'agent.privileged', target: 'builder' }] });

  const res = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read', 'workspace.write', 'shell'] },
    requestedCapabilities: ['workspace.write'],
    authorization: granted
  });

  assert.equal(res.allowed, true);
  assert.deepEqual(res.effectiveCapabilities, ['workspace.write']);
  assert.equal(res.processMode, 'write');

  // Test policy rejection when agent lacks required capability
  const missingRes = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read'] },
    requestedCapabilities: ['workspace.write']
  });
  assert.equal(missingRes.allowed, false);
  assert.equal(missingRes.requiresHumanApproval, false);

  // A grant for a different agent does not authorize this one.
  const otherAgentGrant = createTurnAuthorization({ grants: [{ action: 'agent.privileged', target: 'researcher' }] });
  const unapprovedRes = policy.evaluate({
    agent: { id: 'builder', capabilities: ['workspace.read', 'workspace.write'] },
    requestedCapabilities: ['workspace.write'],
    authorization: otherAgentGrant
  });
  assert.equal(unapprovedRes.allowed, false);
  assert.equal(unapprovedRes.requiresHumanApproval, true);

  const cwd = process.cwd();
  assert.equal(await policy.validateWorkspacePath(cwd, [cwd]), true);
  assert.equal(await policy.validateWorkspacePath(cwd, []), false, 'a zero-root state fails closed');
});

test('Adapters probe status and generate tokens', async () => {
  const acp = new AcpAdapter();
  const processAdapter = new ProcessAdapter({
    selectProvider: () => ({
      provider: {
        id: 'local-1',
        async *streamChat() {
          yield 'Hello from ProcessAdapter';
          yield { type: 'token', value: ' with object token compatibility' };
        }
      },
      source: 'auto-local',
      reason: 'Test provider',
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

// Direct provider access and coordinated agent runs enforce per-turn cloud approval.
test('ProcessAdapter blocks a cloud-tagged provider without a cloud grant, and permits it with one', async () => {
  const cloudProvider = {
    id: 'cloud-1',
    tags: ['cloud'],
    async *streamChat() { yield 'should never stream without approval'; }
  };
  const processAdapter = new ProcessAdapter({ selectProvider: () => ({ provider: cloudProvider, source: 'auto-escalated', reason: 'Test provider' }) });
  const agent = { id: 'researcher', name: 'Researcher', voice: 'af_sarah', instructions: '', capabilities: [] };

  const blocked = [];
  for await (const event of processAdapter.invoke({ prompt: 'test', agent, runId: 'run-1' })) blocked.push(event);
  assert.deepEqual(blocked.map((e) => e.type), ['failed']);
  assert.equal(blocked[0].code, 'cloud_approval_required');
  assert.match(blocked[0].error, /explicit approval/);

  const approved = [];
  const authorization = createTurnAuthorization({ grants: [{ action: 'provider.cloud', target: 'cloud-1' }] });
  for await (const event of processAdapter.invoke({ prompt: 'test', agent, runId: 'run-2', authorization })) approved.push(event);
  assert.ok(approved.some((e) => e.type === 'token' && e.value.includes('should never stream without approval')));
  assert.ok(approved.some((e) => e.type === 'completed'));
});

test('executeAgentRun threads the turn authorization and effective capabilities through to the adapter', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  const agent = app.agentRuntime.registry.get('researcher');
  app.agentRuntime.registry.profiles.set('researcher', { ...agent, adapter: 'process', capabilities: ['workspace.read'] });
  let received;
  app.agentRuntime.adapters.set('process', {
    async *invoke({ agent, runId, authorization, processMode, cwd }) {
      received = { authorization, processMode, cwd };
      yield { type: 'token', runId, agentId: agent.id, value: 'ok' };
      yield { type: 'completed', runId, agentId: agent.id };
    }
  });

  try {
    const authorization = approve(app, { action: 'provider.cloud', target: 'cloud-1' });
    const run = await app.executeAgentRun({ agentId: 'researcher', objective: 'test', mode: 'solo', authorization });
    assert.equal(received.authorization, authorization);
    assert.equal(received.processMode, 'read-only', 'a read-only profile maps to the read-only process mode');
    assert.deepEqual(JSON.parse(run.effective_capabilities), ['workspace.read']);
  } finally {
    cleanup();
  }
});

test('an agent profile pin reaches routing and outranks the configured mode', async () => {
  const { app, cleanup } = createTestApp();
  await app.initialize();
  try {
    const local = app.addProvider({ name: 'Local', protocol: 'openai-compat', base_url: 'http://127.0.0.1:1/v1', model: 'local-model', tags: ['local'], priority: 1 });
    const pinned = app.addProvider({ name: 'Pinned', protocol: 'openai-compat', base_url: 'http://127.0.0.1:2/v1', model: 'pinned-model', tags: ['local'], priority: 90 });
    app.updateOrchestrationSettings({ mode: `provider:${local.id}` });

    // An unpinned agent follows the configured mode.
    assert.equal(app.selectProvider({}).provider.id, local.id);
    // The executing profile's pin outranks it, and only for that turn's input.
    assert.equal(app.selectProvider({ agentProviderId: pinned.id }).provider.id, pinned.id);

    const researcher = app.agentRuntime.registry.get('researcher');
    app.agentRuntime.registry.profiles.set('researcher', { ...researcher, adapter: 'process', provider: pinned.id, capabilities: ['workspace.read'] });

    let seen;
    app.agentRuntime.adapters.set('process', {
      async *invoke({ agent, runId, agentProviderId }) {
        seen = agentProviderId;
        yield { type: 'token', runId, agentId: agent.id, value: 'ok' };
        yield { type: 'completed', runId, agentId: agent.id };
      }
    });

    await app.executeAgentRun({ agentId: 'researcher', objective: 'test', mode: 'solo' });
    assert.equal(seen, pinned.id, 'the profile pin reaches the adapter');
    // Desktop, TUI, and CLI chat have no agent profile, so the pin does not apply there.
    assert.equal(app.selectProvider({}).provider.id, local.id);
  } finally {
    cleanup();
  }
});

test('AcpAdapter rejects a CLI it cannot map to the requested process mode, before spawning', async () => {
  const acp = new AcpAdapter();
  const agent = { id: 'missing', name: 'Missing CLI', voice: 'bf_isabella', instructions: '', capabilities: ['workspace.read'], command: 'definitely_missing_jarvisvx_cli' };

  const events = [];
  for await (const event of acp.invoke({ prompt: 'ping', runId: 'run-1', agent, cwd: process.cwd() })) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'failed');
  assert.equal(events[0].code, 'unsupported_policy');

  // A read-only profile never receives an edit-enabling argument.
  assert.ok(!acp.buildCliArgs('codex', 'ping', '', 'read-only', process.cwd()).includes('workspace-write'));
  assert.ok(acp.buildCliArgs('codex', 'ping', '', 'write', process.cwd()).includes('workspace-write'));
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

// --- agents_send follow-up delivery ---

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
