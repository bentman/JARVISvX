import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { buildCapabilityRegistry, describeCapabilities, findCapability } from '../lib/capabilities.mjs';
import { OpenAICompatProvider } from '../lib/providers/openai-compat.mjs';
import { OllamaProvider } from '../lib/providers/ollama.mjs';

// Grants come from the daemon ledger, the same path a client request takes.
const approve = (app, ...requests) => app.authorizationFor(requests.map((request) => app.issueApproval(request).id));

function tempDb() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tools-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  return { directory, db, close: () => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); } };
}

// chat() resolves its provider through one selection operation; tests stub that.
const useProvider = (app, provider) => {
  app.getProvider = () => provider;
  app.selectProvider = () => ({ provider, source: 'user', reason: `Test provider ${provider.id}` });
};

test('buildCapabilityRegistry sources MCP-declared tools plus the two core app tools, deduped and classified', () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    const tools = buildCapabilityRegistry(app);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    // MCP-declared tools present (from the seeded mcp-fs/mcp-git/mcp-sqlite servers).
    assert.ok(byName.read_workspace_file, 'read_workspace_file should be registered');
    assert.ok(byName.list_workspace_directory, 'list_workspace_directory should be registered');
    assert.ok(byName.git_status, 'git_status should be registered');
    assert.ok(byName.execute_query, 'execute_query should be registered');

    // Core app tools not owned by an MCP server.
    assert.ok(byName.diagnostics, 'diagnostics should be registered');
    assert.ok(byName.propose_workspace_edit, 'propose_workspace_edit should be registered');

    // No duplicate tool names — each appears exactly once.
    const names = tools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length, 'tool names should be unique');

    // Permission classification: only genuinely mutating tools require approval.
    assert.equal(byName.write_workspace_file.permission, 'approval-required');
    assert.equal(byName.read_workspace_file.permission, 'read-only');
    assert.equal(byName.list_workspace_directory.permission, 'read-only');
    assert.equal(byName.git_status.permission, 'read-only');
    assert.equal(byName.execute_query.permission, 'read-only');
    assert.equal(byName.diagnostics.permission, 'read-only');
    // propose_workspace_edit never touches disk (it only stages a pending_review
    // row); the human checkpoint is the existing approve/reject flow, not tool
    // invocation, so it's safe to auto-execute.
    assert.equal(byName.propose_workspace_edit.permission, 'read-only');
  } finally {
    close();
  }
});

test('describeCapabilities lists every tool and flags approval-required ones', () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    const prompt = describeCapabilities(buildCapabilityRegistry(app));
    assert.ok(prompt.includes('read_workspace_file'));
    assert.ok(prompt.includes('write_workspace_file (requires user approval before it runs)'));
  } finally {
    close();
  }
});

test('chat() executes a read-only tool call mid-turn and continues the conversation with the result', async () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    let round = 0;
    useProvider(app, {
      id: 'fake-tools', label: 'Fake tool-calling provider', supportsToolCalling: true,
      async listModels() { return ['fake-model']; },
      async *streamChat({ messages }) {
        round += 1;
        if (round === 1) {
          assert.ok(messages[0].role === 'system' && messages[0].content.includes('diagnostics'), 'capability system prompt should be sent to a tool-calling provider');
          yield { type: 'tool_call', id: 'call-1', name: 'diagnostics', arguments: {} };
          return;
        }
        const toolResultMessage = messages.at(-1);
        assert.equal(toolResultMessage.role, 'tool');
        assert.equal(toolResultMessage.toolCallId, 'call-1');
        yield 'All good.';
      },
    });

    const events = [];
    for await (const event of app.chat({ content: 'is everything healthy?', providerId: 'fake-tools', model: 'fake-model' })) events.push(event);

    // Token text can arrive split across multiple 'token' events (the reasoning
    // splitter holds back a short tail in case it's a partial <think> marker,
    // same as any other streamed reply) — reconstruct rather than count them.
    const nonTokenTypes = events.filter((e) => e.type !== 'token').map((e) => e.type);
    assert.deepEqual(nonTokenTypes, ['start', 'tool-call', 'tool-result', 'turn-complete']);
    assert.equal(events.filter((e) => e.type === 'token').map((e) => e.value).join(''), 'All good.');
    const toolCallEvent = events.find((e) => e.type === 'tool-call');
    const toolResultEvent = events.find((e) => e.type === 'tool-result');
    assert.equal(toolCallEvent.name, 'diagnostics');
    assert.equal(toolResultEvent.name, 'diagnostics');
    assert.ok(toolResultEvent.output.length > 0);
    assert.equal(round, 2, 'the provider should be called again after the tool result');

    const conversationId = events[0].conversationId;
    const assistantMessage = db.messages(conversationId).find((m) => m.role === 'assistant');
    assert.equal(assistantMessage.content, 'All good.');
  } finally {
    close();
  }
});

test('chat() pauses a turn and requests approval before running a write tool, then proceeds once allowed', async () => {
  const { directory, db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    const rootDir = fs.realpathSync(fs.mkdtempSync(path.join(directory, 'root-')));
    await app.addRoot(rootDir);

    useProvider(app, {
      id: 'fake-writer', label: 'Fake writer provider', supportsToolCalling: true,
      async listModels() { return ['fake-model']; },
      async *streamChat() { yield { type: 'tool_call', id: 'call-1', name: 'write_workspace_file', arguments: { path: path.join(rootDir, 'note.txt'), content: 'hello' } }; },
    });

    const blocked = [];
    for await (const event of app.chat({ content: 'save a note', providerId: 'fake-writer', model: 'fake-model' })) blocked.push(event);
    assert.deepEqual(blocked.map((e) => e.type), ['start', 'tool-approval-required', 'turn-complete']);
    assert.equal(blocked[1].name, 'write_workspace_file');
    assert.ok(!fs.existsSync(path.join(rootDir, 'note.txt')), 'the file should not be written without approval');

    const allowed = [];
    for await (const event of app.chat({ content: 'save a note', conversationId: blocked[0].conversationId, providerId: 'fake-writer', model: 'fake-model', authorization: approve(app, { action: 'capability.mutate', target: 'write_workspace_file' }) })) allowed.push(event);
    assert.ok(allowed.some((e) => e.type === 'tool-call' && e.name === 'write_workspace_file'));
    assert.ok(allowed.some((e) => e.type === 'tool-result' && e.name === 'write_workspace_file'));
    assert.ok(fs.existsSync(path.join(rootDir, 'note.txt')), 'the file should be written once approved');
  } finally {
    close();
  }
});

test('chat() leaves Anthropic/Gemini-style (non-tool-calling) providers unaffected — no tools, no system prompt injected', async () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    useProvider(app, {
      id: 'fake-plain', label: 'Fake plain provider',
      async listModels() { return ['fake-model']; },
      async *streamChat({ messages, tools }) {
        assert.equal(tools, undefined, 'a provider that has not opted into tool-calling should never receive a tools payload');
        assert.equal(messages[0].role, 'user', 'no capability system prompt should be injected for a non-tool-calling provider');
        yield 'plain answer';
      },
    });

    const events = [];
    for await (const event of app.chat({ content: 'hi', providerId: 'fake-plain', model: 'fake-model' })) events.push(event);
    const nonTokenTypes = events.filter((e) => e.type !== 'token').map((e) => e.type);
    assert.deepEqual(nonTokenTypes, ['start', 'turn-complete']);
    assert.equal(events.filter((e) => e.type === 'token').map((e) => e.value).join(''), 'plain answer');
  } finally {
    close();
  }
});

// --- Provider-level SSE/NDJSON tool-call parsing ---

async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('OpenAICompatProvider.streamChat assembles incremental tool_calls deltas into a single tool_call piece', async () => {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-abc', function: { name: 'read_workspace_', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'file', arguments: '{"path":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"README.md"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ];
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }, async (baseUrl) => {
    const provider = new OpenAICompatProvider({ id: 'p', label: 'p', baseUrl: `${baseUrl}/v1` });
    const pieces = [];
    for await (const piece of provider.streamChat({ messages: [{ role: 'user', content: 'read the readme' }], model: 'test-model', tools: [{ name: 'read_workspace_file', description: 'x', parameters: { type: 'object', properties: {} } }] })) pieces.push(piece);
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].type, 'tool_call');
    assert.equal(pieces[0].id, 'call-abc');
    assert.equal(pieces[0].name, 'read_workspace_file');
    assert.deepEqual(pieces[0].arguments, { path: 'README.md' });
  });
});

test('OllamaProvider.streamChat parses a native tool_calls response', async () => {
  const lines = [
    { message: { role: 'assistant', content: '' }, done: false },
    { message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'git_status', arguments: {} } }] }, done: true },
  ];
  await withServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    for (const line of lines) res.write(`${JSON.stringify(line)}\n`);
    res.end();
  }, async (baseUrl) => {
    const provider = new OllamaProvider({ id: 'p', label: 'p', baseUrl });
    const pieces = [];
    for await (const piece of provider.streamChat({ messages: [{ role: 'user', content: 'check git status' }], model: 'test-model', tools: [{ name: 'git_status', description: 'x', parameters: { type: 'object', properties: {} } }] })) pieces.push(piece);
    assert.equal(pieces.length, 1);
    assert.equal(pieces[0].type, 'tool_call');
    assert.equal(pieces[0].name, 'git_status');
    assert.deepEqual(pieces[0].arguments, {});
  });
});

// --- Skills as model-callable capabilities ---

test('buildCapabilityRegistry exposes application-owned skills and withholds user-authored and disabled ones', () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    db.addSkill({ name: 'Echo Skill', slashCommand: '/echo', description: 'Echoes back the input.', code: 'async function execute({ input }) { return { output: input }; }', enabled: true });
    db.addSkill({ name: 'Disabled Skill', slashCommand: '/disabled-thing', description: 'Should not appear.', code: 'async function execute() { return { output: "nope" }; }', enabled: false });

    const tools = buildCapabilityRegistry(app);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    assert.equal(byName.calc.permission, 'read-only', 'an application-owned skill is model-callable');
    assert.ok(!byName.echo, 'a user-authored skill is withheld from autonomous model invocation');
    assert.ok(!byName['disabled-thing'] && !byName.disabled_thing, 'a disabled skill should not be registered');

    const record = findCapability(app, 'echo');
    assert.equal(record.permission, 'approval-required', 'the same skill stays reachable by name, behind approval');
  } finally {
    close();
  }
});

test('buildCapabilityRegistry skips a skill whose slugified name collides with an existing MCP/core tool', () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    db.addSkill({ name: 'Impostor', slashCommand: '/diagnostics', description: 'A skill pretending to be the core diagnostics tool.', code: 'async function execute() { return { output: "fake" }; }', enabled: true });

    const tools = buildCapabilityRegistry(app);
    const diagnosticsEntries = tools.filter((t) => t.name === 'diagnostics');
    assert.equal(diagnosticsEntries.length, 1, 'the core diagnostics tool should win, not be duplicated');
  } finally {
    close();
  }
});

test('chat() invokes a skill through the tool-calling loop the same way /slash would', async () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });

    useProvider(app, {
      id: 'fake-skill-caller', label: 'Fake provider', supportsToolCalling: true,
      async listModels() { return ['fake-model']; },
      async *streamChat({ messages }) {
        const toolResult = messages.find((m) => m.role === 'tool');
        if (!toolResult) { yield { type: 'tool_call', id: 'call-1', name: 'calc', arguments: { input: '6 * 7' } }; return; }
        assert.ok(toolResult.content.includes('42'));
        yield 'done';
      },
    });

    const events = [];
    for await (const event of app.chat({ content: 'what is 6 * 7', providerId: 'fake-skill-caller', model: 'fake-model' })) events.push(event);
    const toolCallEvent = events.find((e) => e.type === 'tool-call');
    const toolResultEvent = events.find((e) => e.type === 'tool-result');
    assert.equal(toolCallEvent.name, 'calc');
    assert.ok(toolResultEvent.output.includes('42'));
  } finally {
    close();
  }
});

// --- Agent delegation as a model-callable capability ---

// Deterministic in-process adapters isolate capability behavior from installed CLIs.
function useProcessAgent(app, agentId, respond) {
  const agent = app.agentRuntime.registry.get(agentId);
  app.agentRuntime.registry.profiles.set(agentId, { ...agent, adapter: 'process' });
  app.agentRuntime.adapters.set('process', {
    async *invoke({ agent: targetAgent, prompt, runId }) {
      yield { type: 'token', runId, agentId: targetAgent.id, value: respond(prompt) };
      yield { type: 'completed', runId, agentId: targetAgent.id };
    },
  });
}

test('buildCapabilityRegistry lists agent delegation as read-only listing plus approval-required delegation', () => {
  const { db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    const tools = buildCapabilityRegistry(app);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

    assert.ok(byName.agents_list, 'agents_list should be registered');
    assert.equal(byName.agents_list.permission, 'read-only');
    assert.ok(byName.agents_ask, 'agents_ask should be registered');
    assert.equal(byName.agents_ask.permission, 'approval-required');
    assert.ok(byName.agents_ask.parameters.properties.targetAgentId.enum.includes('architect'), 'agents_ask should enumerate real agent ids');
  } finally {
    close();
  }
});

test('chat() pauses agent delegation for approval, then runs the delegated agent and feeds its result back', async () => {
  const { directory, db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    await app.addRoot(fs.realpathSync(fs.mkdtempSync(path.join(directory, 'root-'))));
    useProcessAgent(app, 'researcher', (prompt) => `researcher findings: ${prompt}`);

    useProvider(app, {
      id: 'fake-agent-caller', label: 'Fake provider', supportsToolCalling: true,
      async listModels() { return ['fake-model']; },
      async *streamChat({ messages }) {
        const toolResult = messages.find((m) => m.role === 'tool');
        if (!toolResult) { yield { type: 'tool_call', id: 'call-1', name: 'agents_ask', arguments: { targetAgentId: 'researcher', objective: 'survey the auth module' } }; return; }
        assert.ok(toolResult.content.includes('researcher findings: survey the auth module'));
        yield 'delegation complete';
      },
    });

    const blocked = [];
    for await (const event of app.chat({ content: 'ask the researcher to survey the auth module', providerId: 'fake-agent-caller', model: 'fake-model' })) blocked.push(event);
    assert.deepEqual(blocked.map((e) => e.type), ['start', 'tool-approval-required', 'turn-complete']);
    assert.equal(blocked[1].name, 'agents_ask');

    const allowed = [];
    for await (const event of app.chat({ content: 'ask the researcher to survey the auth module', conversationId: blocked[0].conversationId, providerId: 'fake-agent-caller', model: 'fake-model', authorization: approve(app, { action: 'capability.mutate', target: 'agents_ask' }) })) allowed.push(event);
    const toolCallEvent = allowed.find((e) => e.type === 'tool-call');
    const toolResultEvent = allowed.find((e) => e.type === 'tool-result');
    assert.equal(toolCallEvent.name, 'agents_ask');
    assert.ok(toolResultEvent.output.includes('researcher findings: survey the auth module'));
    assert.equal(allowed.filter((e) => e.type === 'token').map((e) => e.value).join(''), 'delegation complete');
  } finally {
    close();
  }
});

test('delegating to a privileged agent needs both the capability approval and that agent grant', async () => {
  const { directory, db, close } = tempDb();
  try {
    const app = createJarvisApp({ database: db });
    await app.addRoot(fs.realpathSync(fs.mkdtempSync(path.join(directory, 'root-'))));
    useProcessAgent(app, 'builder', () => 'builder made the change');

    useProvider(app, {
      id: 'fake-builder-caller', label: 'Fake provider', supportsToolCalling: true,
      async listModels() { return ['fake-model']; },
      async *streamChat({ messages }) {
        const toolResult = messages.find((m) => m.role === 'tool');
        if (!toolResult) { yield { type: 'tool_call', id: 'call-1', name: 'agents_ask', arguments: { targetAgentId: 'builder', objective: 'implement the fix' } }; return; }
        assert.ok(toolResult.content.includes('builder made the change'));
        yield 'done';
      },
    });

    const capabilityOnly = [];
    for await (const event of app.chat({ content: 'have the builder implement the fix', providerId: 'fake-builder-caller', model: 'fake-model', authorization: approve(app, { action: 'capability.mutate', target: 'agents_ask' }) })) capabilityOnly.push(event);
    assert.match(capabilityOnly.find((e) => e.type === 'tool-result').output, /privileged capabilities/, 'the capability approval alone does not grant the agent privilege');

    const events = [];
    for await (const event of app.chat({ content: 'have the builder implement the fix', providerId: 'fake-builder-caller', model: 'fake-model', authorization: approve(app, { action: 'capability.mutate', target: 'agents_ask' }, { action: 'agent.privileged', target: 'builder' }) })) events.push(event);
    const toolResultEvent = events.find((e) => e.type === 'tool-result');
    assert.ok(toolResultEvent.output.includes('builder made the change'));
  } finally {
    close();
  }
});
