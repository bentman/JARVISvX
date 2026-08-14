import { spawn } from 'node:child_process';

export class AcpAdapter {
  constructor() {
    this.name = 'acp';
    this.runs = new Map();
  }

  async probe() {
    return { status: 'available', protocol: 'acp/1.0', transport: 'stdio' };
  }

  buildCliArgs(cmd, prompt, instructions) {
    const fullText = instructions ? `${instructions}\n\nTask: ${prompt}` : prompt;
    switch (cmd) {
      case 'claude':
        return ['--print', fullText];
      case 'codex':
        return ['exec', fullText, '-s', 'workspace-write', '-c', 'approval_policy=on-request', '--json'];
      case 'copilot':
        return ['-p', fullText, '--output-format', 'json', '--no-color'];
      case 'cline':
        return [fullText, '--json', '--auto-approve', 'true', '--cwd', process.cwd()];
      case 'agy':
        return [
          '--print',
          fullText,
          '--mode',
          'accept-edits',
          '--sandbox',
          '--output-format',
          'json',
          '--add-dir',
          process.cwd(),
          '--new-project'
        ];
      default:
        return [];
    }
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

  async *invoke({ prompt, agent, conversationId, runId, signal, command = 'npx', args = ['@agentclientprotocol/cli'] }) {
    const cmd = agent.command || agent.cli || command;
    const isStandardAcp = cmd === 'npx' || cmd === 'acp' || String(cmd).endsWith('@agentclientprotocol/cli');
    const spawnArgs = agent.args || (isStandardAcp ? args : this.buildCliArgs(cmd, prompt, agent.instructions));

    let child = null;
    let spawnError = null;

    try {
      child = spawn(cmd, spawnArgs, {
        stdio: [isStandardAcp ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });
    } catch (err) {
      spawnError = err;
    }

    if (!child) {
      yield this.failureEvent({
        runId,
        agent,
        message: `Command '${cmd}' is not available on PATH (${spawnError?.message || 'ENOENT'}).`
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
          capabilities: agent.capabilities
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
}
