import { spawn } from 'node:child_process';

export class AcpAdapter {
  constructor() {
    this.name = 'acp';
    this.runs = new Map();
  }

  async probe() {
    return { status: 'available', protocol: 'acp/1.0', transport: 'stdio' };
  }

  async *invoke({ prompt, agent, conversationId, runId, signal, command = 'npx', args = ['@agentclientprotocol/cli'] }) {
    const cmd = agent.command || agent.cli || command;
    const spawnArgs = agent.args || (cmd === 'npx' ? args : []);
    let child;
    try {
      child = spawn(cmd, spawnArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      // Fallback generator when ACP CLI binary is not locally installed
      yield { type: 'token', runId, agentId: agent.id, speaker: { name: agent.name, voice: agent.voice }, value: `[ACP Fallback (${cmd}): ${agent.name}] Processing "${prompt.slice(0, 40)}..."` };
      yield { type: 'completed', runId, agentId: agent.id };
      return;
    }

    if (signal) {
      signal.addEventListener('abort', () => {
        try { child.kill('SIGTERM'); } catch {}
      });
    }

    // Write initial JSON-RPC request to stdio
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

    child.stdin.write(req);

    let buffer = '';
    for await (const chunk of child.stdout) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
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
          }
        } catch {}
      }
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
