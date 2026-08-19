// Model Context Protocol client for the stdio transport: spawns the server
// command, performs the standard `initialize` handshake, and exchanges
// JSON-RPC 2.0 messages over stdin/stdout — one message per line, matching
// the framing the stdio transport uses (see https://modelcontextprotocol.io).
// Each call opens a fresh process for the duration of the request and closes
// it afterward, the same per-call lifecycle lib/mcp-skills.mjs already uses
// for `git_status`/`git_diff` (execFile per call rather than a long-lived
// connection pool).

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

// Splits a shell-style command string into argv, honoring double- or
// single-quoted segments (no further shell parsing — no pipes, redirects, or
// variable expansion, the same restricted surface `execFile` calls elsewhere
// in this codebase already assume for external commands).
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

// Converts a real MCP tool's JSON Schema `inputSchema` into the loose
// "name: type, name2?: type2" spec string this app's other MCP tools use
// (see lib/capabilities.mjs's parseParameterSpec), so a stdio server's real
// tools flow through the same capability-registry path as the built-in ones.
function describeInputSchema(schema) {
  if (!schema || schema.type !== 'object' || !schema.properties || !Object.keys(schema.properties).length) return 'none';
  const required = new Set(schema.required || []);
  return Object.keys(schema.properties).map((name) => `${name}${required.has(name) ? '' : '?'}: ${schema.properties[name]?.type || 'string'}`).join(', ');
}

// Connects to the given stdio command and performs only the `initialize`
// handshake, then disconnects — a real, minimal connectivity check for the
// "ping" action, cheaper than a full tools/list.
export async function pingStdio(command) {
  return withSession(command, async () => true);
}

// Connects to the given stdio command, lists its real declared tools, and
// disconnects. Used both to populate a newly-added server's tools_json (see
// lib/application.mjs's addMcpServer) and as a real connectivity check.
export async function listStdioTools(command) {
  return withSession(command, async (session) => {
    const result = await session.request('tools/list', {});
    return (result?.tools || []).map((tool) => ({
      name: tool.name,
      description: tool.description || `Run the ${tool.name} tool.`,
      parameters: describeInputSchema(tool.inputSchema),
      mutating: Boolean(tool.annotations?.readOnlyHint === false || tool.annotations?.destructiveHint),
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
