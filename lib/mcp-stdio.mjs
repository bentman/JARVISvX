// Model Context Protocol client for the stdio transport: spawns the server
// command, performs the standard `initialize` handshake, and exchanges
// JSON-RPC 2.0 messages over stdin/stdout — one message per line, matching
// the framing the stdio transport uses (see https://modelcontextprotocol.io).
// Each call owns a process for the request duration; no connection pool persists.

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 15000;

class StdioMcpSession {
  constructor(command) {
    const [cmd, ...args] = parseCommand(command);
    if (!cmd) throw new Error('No command given for stdio MCP server.');
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.stderr = '';
    this.closed = false;
    this.spawnError = null;

    this.child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error', (error) => { this.spawnError = error; this._rejectAll(new Error(`Could not start the MCP server command: ${error.message}`)); });
    this.child.on('exit', () => { this._rejectAll(new Error(`MCP server process exited before responding.${this.stderr ? ` stderr: ${this.stderr.trim().slice(0, 500)}` : ''}`)); });
    this.child.stderr.on('data', (chunk) => { this.stderr += chunk.toString('utf8'); if (this.stderr.length > 4000) this.stderr = this.stderr.slice(-4000); });
    this.child.stdout.on('data', (chunk) => this._onData(chunk));
  }

  _onData(chunk) {
    this.buffer += chunk.toString('utf8');
    let index;
    while ((index = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.id === undefined || message.id === null) continue; // notification from server, not a reply
      const waiter = this.pending.get(message.id);
      if (!waiter) continue;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || 'MCP server returned an error.'));
      else waiter.resolve(message.result);
    }
  }

  _rejectAll(error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }

  request(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (this.spawnError) return Promise.reject(new Error(`Could not start the MCP server command: ${this.spawnError.message}`));
    const id = this.nextId++;
    const line = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP server did not respond to "${method}" within ${timeoutMs}ms.${this.stderr ? ` stderr: ${this.stderr.trim().slice(0, 500)}` : ''}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child.stdin.write(line, (error) => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }

  notify(method, params = {}) {
    if (this.spawnError || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.child.stdin.end(); } catch { /* already closed */ }
    this.child.kill();
  }
}

// Command parsing supports quoted argv segments and excludes shell expansion,
// pipes, and redirects.
function parseCommand(command) {
  const parts = String(command || '').match(/"[^"]*"|'[^']*'|\S+/g) || [];
  return parts.map((part) => part.replace(/^['"]|['"]$/g, ''));
}

async function withSession(command, fn) {
  const session = new StdioMcpSession(command);
  try {
    await session.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'JARVISvX', version: '0.1.0' },
    });
    session.notify('notifications/initialized');
    return await fn(session);
  } finally {
    session.close();
  }
}

// Ping performs initialization only, then disconnects without requesting tools.
export async function pingStdio(command) {
  return withSession(command, async () => true);
}

// Tool discovery initializes the command, requests tools/list, and disconnects.
export async function listStdioTools(command) {
  return withSession(command, async (session) => {
    const result = await session.request('tools/list', {});
    // The discovered schema and annotations are the server's callable contract and
    // are stored as given; how they are converted is the capability registry's job.
    return (result?.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description || `Run the ${tool.name} tool.`,
      inputSchema: tool.inputSchema || null,
      annotations: tool.annotations || null,
    }));
  });
}

// Calls one tool on the given stdio command and returns its text output.
export async function callStdioTool(command, toolName, args = {}) {
  return withSession(command, async (session) => {
    const result = await session.request('tools/call', { name: toolName, arguments: args });
    const text = (result?.content || [])
      .map((block) => (typeof block?.text === 'string' ? block.text : JSON.stringify(block)))
      .join('\n');
    if (result?.isError) throw new Error(text || `MCP tool "${toolName}" reported an error.`);
    return text || JSON.stringify(result ?? null);
  });
}
