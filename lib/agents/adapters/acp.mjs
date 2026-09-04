import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROCESS_MODES } from '../policy.mjs';

const isWindows = process.platform === 'win32';

// Argument forms per CLI and process mode. This table is the application's own
// declaration of how a capability set maps onto a target CLI; a pair with no entry
// is rejected before the process starts.
const CLI_MODE_ARGS = {
  claude: {
    [PROCESS_MODES.readOnly]: (text) => ['--print', '--permission-mode', 'plan', text],
    [PROCESS_MODES.write]: (text) => ['--print', '--permission-mode', 'acceptEdits', text],
    [PROCESS_MODES.shell]: (text) => ['--print', '--permission-mode', 'bypassPermissions', text],
  },
  codex: {
    [PROCESS_MODES.readOnly]: (text) => ['exec', text, '-s', 'read-only', '-c', 'approval_policy=on-request', '--json'],
    [PROCESS_MODES.write]: (text) => ['exec', text, '-s', 'workspace-write', '-c', 'approval_policy=on-request', '--json'],
    [PROCESS_MODES.shell]: (text) => ['exec', text, '-s', 'danger-full-access', '-c', 'approval_policy=on-request', '--json'],
  },
  // copilot needs --allow-all-tools to run non-interactively at all, so read-only
  // subtracts the two mutation-capable tool rules from it.
  copilot: {
    [PROCESS_MODES.readOnly]: (text, cwd) => ['-p', text, '--allow-all-tools', '--deny-tool', 'write', '--deny-tool', 'shell', '--output-format', 'json', '--no-color', '-C', cwd],
    [PROCESS_MODES.write]: (text, cwd) => ['-p', text, '--allow-all-tools', '--deny-tool', 'shell', '--output-format', 'json', '--no-color', '-C', cwd],
    [PROCESS_MODES.shell]: (text, cwd) => ['-p', text, '--allow-all-tools', '--output-format', 'json', '--no-color', '-C', cwd],
  },
  // cline auto-approves every tool unless told otherwise, so read-only states it.
  cline: {
    [PROCESS_MODES.readOnly]: (text, cwd) => [text, '--plan', '--auto-approve', 'false', '--json', '--cwd', cwd],
    [PROCESS_MODES.write]: (text, cwd) => [text, '--auto-approve', 'true', '--json', '--cwd', cwd],
    [PROCESS_MODES.shell]: (text, cwd) => [text, '--auto-approve', 'true', '--json', '--cwd', cwd],
  },
  agy: {
    [PROCESS_MODES.readOnly]: (text, cwd) => ['--print', text, '--mode', 'plan', '--sandbox', '--output-format', 'json', '--add-dir', cwd],
    [PROCESS_MODES.write]: (text, cwd) => ['--print', text, '--mode', 'accept-edits', '--sandbox', '--output-format', 'json', '--add-dir', cwd, '--new-project'],
  },
};

class UnsupportedPolicyError extends Error {
  constructor(message) { super(message); this.name = 'UnsupportedPolicyError'; this.code = 'unsupported_policy'; }
}

// A session runs as exactly one platform. A Linux session, WSL included, uses
// Linux executables; a Windows session uses Windows executables. A Windows mount
// visible from WSL belongs to the other session, so it is not searched.
const WINDOWS_MOUNT = /^\/mnt\/[a-z](\/|$)/i;

const resolutionCache = new Map();

// Windows resolves a bare command through PATH and PATHEXT, and runs a .cmd or
// .bat shim under the command processor. POSIX execs the file directly.
function resolveOnWindows(cmd) {
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const candidates = path.isAbsolute(cmd) || cmd.includes(path.sep)
    ? [cmd, ...extensions.map((extension) => cmd + extension)]
    : (process.env.PATH || '').split(path.delimiter).filter(Boolean)
        .flatMap((dir) => ['', ...extensions].map((extension) => path.join(dir, cmd + extension)));
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return { available: true, file: candidate }; } catch {}
  }
  return { available: false, reason: `"${cmd}" is not installed for this Windows session.` };
}

function resolveOnPosix(cmd) {
  const candidates = cmd.includes(path.sep)
    ? [path.resolve(cmd)]
    : (process.env.PATH || '').split(path.delimiter).filter((dir) => dir && !WINDOWS_MOUNT.test(dir)).map((dir) => path.join(dir, cmd));
  for (const candidate of candidates) {
    if (WINDOWS_MOUNT.test(candidate)) continue;
    try { fs.accessSync(candidate, fs.constants.X_OK); return { available: true, file: candidate }; } catch {}
  }
  return { available: false, reason: `"${cmd}" is not installed for this ${process.platform} session.` };
}

// Resolution is stable for the life of the daemon, so each command is resolved once.
export function resolveAgentCommand(cmd) {
  if (!resolutionCache.has(cmd)) resolutionCache.set(cmd, isWindows ? resolveOnWindows(cmd) : resolveOnPosix(cmd));
  return resolutionCache.get(cmd);
}

const quoteWindowsArg = (value) => {
  const text = String(value);
  if (text === '') return '""';
  if (!/[\s"]/.test(text)) return text;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
};

// The command processor strips these escapes and hands the child the same argument
// vector a POSIX exec would produce.
const escapeForCommandProcessor = (line) => line.replace(/[()%!^"<>&|]/g, '^$&');

function spawnAgentProcess(executable, args, options) {
  if (!isWindows) return spawn(executable, args, options);
  const extension = path.extname(executable).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return spawn(executable, args, options);
  const line = escapeForCommandProcessor([executable, ...args].map(quoteWindowsArg).join(' '));
  return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true });
}

// ACP shells out to independently configured CLIs and never resolves a JARVIS provider.
// JARVIS cloud approval therefore applies at the chat and ProcessAdapter boundaries.
export class AcpAdapter {
  constructor() {
    this.name = 'acp';
    this.runs = new Map();
  }

  async probe() {
    return { status: 'available', protocol: 'acp/1.0', transport: 'stdio' };
  }

  buildCliArgs(cmd, prompt, instructions, mode = PROCESS_MODES.readOnly, cwd) {
    const fullText = instructions ? `${instructions}\n\nTask: ${prompt}` : prompt;
    const build = CLI_MODE_ARGS[cmd]?.[mode];
    if (!build) throw new UnsupportedPolicyError(`The "${cmd}" CLI has no ${mode} process mode; this capability set cannot be enforced.`);
    return build(fullText, cwd);
  }

  failureEvent({ runId, agent, message }) {
    return {
      type: 'failed',
      runId,
      agentId: agent.id,
      speaker: { name: agent.name, voice: agent.voice },
      error: message
    };
  }

  async *invoke({ prompt, agent, conversationId, runId, signal, cwd, processMode = PROCESS_MODES.readOnly, command = 'npx', args = ['@agentclientprotocol/cli'] }) {
    const cmd = agent.command || agent.cli || command;
    const isStandardAcp = cmd === 'npx' || cmd === 'acp' || String(cmd).endsWith('@agentclientprotocol/cli');

    let spawnArgs;
    try {
      spawnArgs = isStandardAcp ? args : this.buildCliArgs(cmd, prompt, agent.instructions, processMode, cwd);
    } catch (policyError) {
      yield { ...this.failureEvent({ runId, agent, message: policyError.message }), code: policyError.code };
      return;
    }

    const resolved = resolveAgentCommand(cmd);
    if (!resolved.available) {
      yield { ...this.failureEvent({ runId, agent, message: resolved.reason }), code: 'cli_unavailable' };
      return;
    }

    let child = null;
    let spawnError = null;

    try {
      child = spawnAgentProcess(resolved.file, spawnArgs, {
        stdio: [isStandardAcp ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        cwd,
        env: { ...process.env }
      });
    } catch (err) {
      spawnError = err;
    }

    if (!child) {
      yield this.failureEvent({
        runId,
        agent,
        message: `Command '${cmd}' could not be started (${spawnError?.message || 'ENOENT'}).`
      });
      return;
    }

    // Attach error handler immediately to avoid unhandled 'error' event crashes
    child.on('error', (err) => {
      spawnError = err;
    });

    if (runId) this.runs.set(runId, child);

    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.JARVIS_TEST) || process.argv.some((a) => a.includes('test'));
    const configuredTimeout = Number.parseInt(process.env.JARVIS_AGENT_TIMEOUT_MS || '', 10);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : isTest ? 1500 : 300000;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      if (child && child.exitCode === null) {
        timedOut = true;
        try { child.kill('SIGTERM'); } catch {}
      }
    }, timeoutMs);

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutTimer);
        try { child.kill('SIGTERM'); } catch {}
      });
    }

    let stdoutBuffer = '';
    let stderrBuffer = '';
    let emittedOutput = false;

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
      });
    }

    if (isStandardAcp && child.stdin) {
      const req = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'agent.invoke',
        params: {
          prompt,
          role: agent.id,
          instructions: agent.instructions,
          capabilities: agent.capabilities,
          mode: processMode,
          cwd
        }
      }) + '\n';
      try { child.stdin.write(req); } catch {}
    }

    if (child.stdout) {
      try {
        for await (const chunk of child.stdout) {
          const text = chunk.toString();
          stdoutBuffer += text;

          if (isStandardAcp) {
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const msg = JSON.parse(line);
                if (msg.params?.token) {
                  yield {
                    type: 'token',
                    runId,
                    agentId: agent.id,
                    speaker: { name: agent.name, voice: agent.voice },
                    value: msg.params.token
                  };
                  emittedOutput = true;
                }
              } catch {}
            }
          } else {
            emittedOutput = true;
            yield {
              type: 'token',
              runId,
              agentId: agent.id,
              speaker: { name: agent.name, voice: agent.voice },
              value: text
            };
          }
        }
      } catch (err) {
        spawnError = spawnError || err;
      }
    }

    const exitCode = await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve(child.exitCode);
      child.once('close', (code) => resolve(code ?? 0));
    });

    clearTimeout(timeoutTimer);
    if (runId) this.runs.delete(runId);

    if (spawnError) {
      yield this.failureEvent({
        runId,
        agent,
        message: `${cmd} error: ${spawnError.message}`
      });
      return;
    }

    if (timedOut) {
      yield this.failureEvent({
        runId,
        agent,
        message: `${cmd} timed out after ${timeoutMs}ms.`
      });
      return;
    }

    if (exitCode !== 0) {
      yield this.failureEvent({
        runId,
        agent,
        message: `${cmd} exited with code ${exitCode}${stderrBuffer.trim() ? `: ${stderrBuffer.trim()}` : '.'}`
      });
      return;
    }

    if (!emittedOutput) {
      yield this.failureEvent({
        runId,
        agent,
        message: `${cmd} completed without producing agent output.`
      });
      return;
    }

    yield { type: 'completed', runId, agentId: agent.id };
  }

  async cancel(runId) {
    const child = this.runs.get(runId);
    if (child) {
      try { child.kill('SIGTERM'); } catch {}
      this.runs.delete(runId);
    }
  }

  // Standard ACP mode has writable stdin; fixed CLI modes are one-shot processes.
  send(runId, message) {
    const child = this.runs.get(runId);
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return { success: false, error: `Run "${runId}" has no active process (it may have already completed).` };
    }
    if (!child.stdin || !child.stdin.writable) {
      return { success: false, error: `Run "${runId}" is not running in an interactive mode that accepts follow-up input.` };
    }
    try {
      child.stdin.write(`${message}\n`);
      return { success: true, status: 'sent', runId };
    } catch (error) {
      return { success: false, error: `Failed to send to run "${runId}": ${error.message}` };
    }
  }
}
