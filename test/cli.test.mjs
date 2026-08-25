import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { voiceModelManifest } from '../lib/model-bootstrap.mjs';

// Runs the CLI as a child process against a daemon backed by a temporary database.
// External-agent success paths require installed CLIs and have argument validation
// coverage here; their runtime behavior is covered by deterministic adapter tests.

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cliPath = path.join(repoRoot, 'bin', 'jarvis.mjs');

async function withDaemon(fn) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-cli-'));
  const modelDir = path.join(directory, 'models');
  process.env.JARVIS_DATA_DIR = directory;
  process.env.JARVIS_MODEL_DIR = modelDir;
  for (const model of voiceModelManifest) {
    for (const [file] of model.files) {
      const target = path.join(modelDir, model.directory, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file === 'voices-v1.0.bin' ? 'fixture-voices' : 'fixture-model');
    }
  }
  const { startDaemon } = await import('../lib/daemon.mjs');
  const daemon = await startDaemon({ port: 0, token: 'cli-test-token' });
  try {
    await fn({ directory, daemon, env: { ...process.env, JARVIS_DATA_DIR: directory, JARVIS_MODEL_DIR: modelDir } });
  } finally {
    await daemon.close();
    await fs.rm(directory, { recursive: true, force: true });
    delete process.env.JARVIS_DATA_DIR;
    delete process.env.JARVIS_MODEL_DIR;
  }
}

// Spawns the CLI as a child process. `stdin` controls how stdin is wired:
// 'ignore' closes it immediately (simulates a non-interactive invocation with
// nothing piped in — must not hang), a string pipes that exact content then
// closes it (simulates `echo "..." | jarvis ask`).
function cli(args, { env, stdin = 'ignore', timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: repoRoot,
      env,
      stdio: [stdin === 'ignore' ? 'ignore' : 'pipe', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`jarvis ${args.join(' ')} timed out`)); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    if (stdin !== 'ignore' && typeof stdin === 'string') { child.stdin.write(stdin); child.stdin.end(); }
  });
}

test('jarvis version and help never require a running daemon connection', async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  // Version and help must remain independent of daemon discovery.
  const version = await cli(['version'], { env: { ...process.env, JARVIS_DATA_DIR: path.join(os.tmpdir(), 'jarvis-cli-no-daemon-should-not-be-touched') } });
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);

  const help = await cli(['--help'], { env: process.env });
  assert.equal(help.code, 0);
  for (const needle of ['agent run', 'mcp list', 'skills list', 'settings mode', 'ask "<message>"']) {
    assert.ok(help.stdout.includes(needle), `help output should mention "${needle}"`);
  }
});

test('jarvis agent list prints the real built-in agent roster', async () => {
  await withDaemon(async ({ env }) => {
    const result = await cli(['agent', 'list'], { env });
    assert.equal(result.code, 0);
    for (const id of ['architect', 'reviewer', 'builder', 'security', 'debugger', 'researcher', 'adversary']) {
      assert.ok(result.stdout.includes(id), `agent list should include ${id}`);
    }
    // `jarvis agents` is a documented shorthand for `jarvis agent list`.
    const shorthand = await cli(['agents'], { env });
    assert.equal(shorthand.stdout, result.stdout);
  });
});

test('jarvis agent run/panel/debate validate their arguments before touching the daemon', async () => {
  await withDaemon(async ({ env }) => {
    const missingObjective = await cli(['agent', 'run', 'architect'], { env });
    assert.notEqual(missingObjective.code, 0);
    assert.match(missingObjective.stderr, /Usage: jarvis agent run/);

    const missingSeparator = await cli(['agent', 'panel', 'architect', 'reviewer'], { env });
    assert.notEqual(missingSeparator.code, 0);
    assert.match(missingSeparator.stderr, /Usage: jarvis agent panel/);
  });
});

test('jarvis mcp add/list/ping/remove round-trips through the real MCP server registry', async () => {
  await withDaemon(async ({ env }) => {
    // The seeded built-in filesystem server pings without any network access.
    const ping = await cli(['mcp', 'ping', 'mcp-fs'], { env });
    assert.equal(ping.code, 0);
    assert.match(ping.stdout, /"status": "connected"/);

    const add = await cli(['mcp', 'add', 'Test HTTP Server', 'https://example.invalid/mcp'], { env });
    assert.equal(add.code, 0);
    const id = add.stdout.match(/^Added:\s+(\S+)/)?.[1];
    assert.ok(id, `expected an id in "${add.stdout}"`);

    const list = await cli(['mcp', 'list'], { env });
    assert.ok(list.stdout.includes('Test HTTP Server'));

    const remove = await cli(['mcp', 'remove', id], { env });
    assert.equal(remove.code, 0);
    const listAfter = await cli(['mcp', 'list'], { env });
    assert.ok(!listAfter.stdout.includes('Test HTTP Server'));
  });
});

test('jarvis skills list/toggle/export round-trip through the real skills store', async () => {
  await withDaemon(async ({ env, directory }) => {
    const list = await cli(['skills', 'list'], { env });
    assert.equal(list.code, 0);
    assert.ok(list.stdout.length > 0, 'expected the seeded default skills to be listed');
    const firstCommand = list.stdout.split('\n')[0].trim().split(/\s+/)[0];
    assert.ok(firstCommand.startsWith('/'), `expected a slash command, got "${firstCommand}"`);

    // Resolve the id behind that slash command via the daemon directly (the
    // CLI's list output only prints the command, not the id, by design).
    const { DaemonClient } = await import('../lib/daemon-client.mjs');
    const client = await DaemonClient.connect();
    const skills = await client.skills();
    const target = skills.find((s) => s.slashCommand === firstCommand);
    assert.ok(target, `expected to find skill for ${firstCommand}`);

    const toggled = await cli(['skills', 'toggle', target.id], { env });
    assert.equal(toggled.code, 0);
    assert.match(toggled.stdout, /(enabled|disabled)/);

    const outFile = path.join(directory, 'exported-skill.md');
    const exported = await cli(['skills', 'export', target.id, '--out', outFile], { env });
    assert.equal(exported.code, 0);
    const content = await fs.readFile(outFile, 'utf8');
    assert.match(content, /^---\nname: /);
    assert.ok(content.includes(`slashCommand: ${target.slashCommand}`));
  });
});

test('jarvis skills import requires a source argument (network path already covered by skills-source.test.mjs)', async () => {
  await withDaemon(async ({ env }) => {
    const result = await cli(['skills', 'import'], { env });
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Usage: jarvis skills import/);
  });
});

test('jarvis settings get/mode reads and updates the real consolidated settings', async () => {
  await withDaemon(async ({ env }) => {
    const initial = await cli(['settings'], { env });
    assert.equal(initial.code, 0);
    const parsed = JSON.parse(initial.stdout);
    for (const key of ['activeProvider', 'activeModel', 'cloudConfigured', 'activeProviderLabel', 'isCloudProvider', 'mode', 'autoEscalateRules']) {
      assert.ok(key in parsed, `settings output missing "${key}"`);
    }

    const updated = await cli(['settings', 'mode', 'local_only'], { env });
    assert.equal(updated.code, 0);
    assert.equal(updated.stdout.trim(), 'Mode: local_only');

    const confirmed = await cli(['settings', 'get'], { env });
    assert.equal(JSON.parse(confirmed.stdout).mode, 'local_only');
  });
});

test('jarvis ask reads a piped message from stdin and surfaces the real daemon error when no provider is configured', async () => {
  await withDaemon(async ({ env }) => {
    const noArgsNoStdin = await cli(['ask'], { env, stdin: 'ignore' });
    assert.notEqual(noArgsNoStdin.code, 0);
    assert.match(noArgsNoStdin.stderr, /Usage: jarvis ask/);

    const piped = await cli(['ask', '--json'], { env, stdin: 'hello from a pipe' });
    assert.equal(piped.code, 0);
    // A provider error proves piped stdin reached the chat pipeline.
    assert.ok(!piped.stderr.includes('Usage: jarvis ask'));
    const events = piped.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.type === 'error'));
  });
});

test('automatic selection omits providerId from the request; a pinned provider sends it', async () => {
  await withDaemon(async ({ daemon, env }) => {
    const received = [];
    const chat = daemon.jarvis.chat.bind(daemon.jarvis);
    daemon.jarvis.chat = async function* (options) {
      received.push(Object.prototype.hasOwnProperty.call(options, 'providerId') ? options.providerId : '<absent>');
      yield* chat(options);
    };

    await cli(['ask', 'hello'], { env });
    assert.equal(received[0], '<absent>', 'automatic sends no providerId');

    await cli(['ask', 'hello', '--provider', 'pinned-id'], { env });
    assert.equal(received[1], 'pinned-id', 'a pinned provider is serialized');
  });
});
