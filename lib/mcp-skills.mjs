import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pingStdio, callStdioTool } from './mcp-stdio.mjs';
import { resolveWithinRoots, selectApprovedRoot } from './tools.mjs';

const execFileAsync = promisify(execFile);
const RPC_TIMEOUT_MS = 15000;

const isBuiltInServer = (server) => server.type === 'built-in' || /^(workspace|sqlite):\/\//.test(server.endpoint || '');

// One JSON-RPC exchange over HTTP, with a request id, a bounded timeout, and
// response validation. A protocol-level error is an error, not a payload.
export async function httpJsonRpc(endpoint, method, params = {}, { timeoutMs = RPC_TIMEOUT_MS, signal } = {}) {
  const id = crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(controller.signal.aborted ? `MCP server did not respond to "${method}" within ${timeoutMs}ms.` : `MCP server is unreachable: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`MCP server returned HTTP ${response.status} for "${method}".`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) throw new Error(`MCP server answered "${method}" with ${contentType || 'no content type'} instead of JSON.`);
  const body = await response.json().catch(() => { throw new Error(`MCP server sent malformed JSON for "${method}".`); });
  if (body?.error) throw new Error(body.error.message || `MCP server reported an error for "${method}".`);
  return body?.result;
}

// Health is measured by a real exchange with whatever owns the server: the
// approved-root resolver, the database, or the transport's own handshake.
export async function pingMcpServer(server, app) {
  const startTime = Date.now();
  const elapsed = () => Date.now() - startTime;
  try {
    if (isBuiltInServer(server)) {
      if (server.endpoint.startsWith('sqlite://')) app.db.readModel('conversation_counts');
      else await selectApprovedRoot(app.roots().map((root) => root.path));
    } else if (server.type === 'stdio') {
      await pingStdio(server.endpoint);
    } else if (/^https?:\/\//.test(server.endpoint || '')) {
      await httpJsonRpc(server.endpoint, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'JARVISvX', version: '0.1.0' } });
    } else {
      throw new Error(`No health check is implemented for server type "${server.type}".`);
    }
    return { status: 'connected', latencyMs: elapsed(), failureReason: null };
  } catch (error) {
    return { status: 'error', latencyMs: elapsed(), failureReason: (error.message || 'Probe failed.').slice(0, 500) };
  }
}

export async function executeMcpTool(server, toolName, params = {}, app) {
  const startTime = Date.now();
  const roots = app.roots().map((r) => r.path);

  try {
    if (toolName === 'read_workspace_file') {
      const filePath = params.path || params.file || '';
      if (!filePath) throw new Error('Parameter "path" is required.');
      const result = await app.readFile(filePath);
      return {
        success: true,
        tool: toolName,
        output: result.content,
        metadata: { path: result.path, size: result.size },
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'write_workspace_file') {
      const filePath = params.path || params.file || '';
      if (!filePath) throw new Error('Parameter "path" is required.');
      const written = await app.writeFile(filePath, params.content || '');
      return {
        success: true,
        tool: toolName,
        output: `Successfully wrote ${written.bytesWritten} bytes to ${written.path}`,
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'list_workspace_directory') {
      const base = await selectApprovedRoot(roots);
      const target = await resolveWithinRoots(params.path ? path.resolve(base, params.path) : base, roots, { mustExist: true });
      const items = await fs.readdir(target, { withFileTypes: true });
      const formatted = items.map((item) => `${item.isDirectory() ? '[DIR] ' : '[FILE]'} ${item.name}`).join('\n');
      return {
        success: true,
        tool: toolName,
        output: formatted || '(Directory is empty)',
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'git_status') {
      const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], { cwd: await selectApprovedRoot(roots) });
      return {
        success: true,
        tool: toolName,
        output: stdout || 'Working tree clean',
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'git_diff') {
      const cwd = await selectApprovedRoot(roots);
      const args = ['diff'];
      if (params.file) args.push(await resolveWithinRoots(path.resolve(cwd, params.file), roots));
      const { stdout } = await execFileAsync('git', args, { cwd });
      return {
        success: true,
        tool: toolName,
        output: stdout || 'No uncommitted changes',
        durationMs: Date.now() - startTime
      };
    }

    // Reads resolve to an application-owned read model, so this capability's data
    // visibility is the set of fields those models declare.
    if (toolName === 'execute_query') {
      const model = (params.model || '').trim();
      if (!model) throw new Error(`Parameter "model" is required. Available read models: ${app.db.readModelNames().join(', ')}.`);
      const rows = app.db.readModel(model, { limit: params.limit });
      return {
        success: true,
        tool: toolName,
        output: JSON.stringify(rows, null, 2),
        durationMs: Date.now() - startTime
      };
    }

    // The stdio endpoint is a command; each call performs MCP initialization and tools/call.
    if (server.type === 'stdio') {
      const output = await callStdioTool(server.endpoint, toolName, params);
      return { success: true, tool: toolName, output, durationMs: Date.now() - startTime };
    }

    if (/^https?:\/\//.test(server.endpoint || '')) {
      const result = await httpJsonRpc(server.endpoint, 'tools/call', { name: toolName, arguments: params });
      const text = (result?.content || []).map((block) => (typeof block?.text === 'string' ? block.text : JSON.stringify(block))).join('\n');
      if (result?.isError) throw new Error(text || `MCP tool "${toolName}" reported an error.`);
      return {
        success: true,
        tool: toolName,
        output: text || (typeof result === 'string' ? result : JSON.stringify(result ?? null, null, 2)),
        durationMs: Date.now() - startTime
      };
    }

    // No execution path exists for this server type — report that plainly
    // instead of claiming the tool ran. server.type === 'sse' lands here:
    // that transport is not implemented yet (see McpSkillsView.tsx, which
    // marks it unavailable in the "Add MCP Server" form for the same reason).
    throw new Error(`No execution path is implemented for server type "${server.type}".`);
  } catch (error) {
    return {
      success: false,
      tool: toolName,
      error: error.message || 'Tool execution error',
      output: `Error executing ${toolName}: ${error.message}`,
      durationMs: Date.now() - startTime
    };
  }
}

// The interface a skill body receives. It exposes named application operations and
// routes the one provider-backed operation through the turn's authorization.
export function createSkillContext(app, { authorization } = {}) {
  return Object.freeze({
    diagnostics: () => app.diagnostics(),
    roots: () => app.roots(),
    readFile: (filePath) => app.readFile(filePath),
    searchWorkspace: (query) => app.searchWorkspace(query),
    mcpServers: () => app.mcpServers(),
    memories: (category) => app.memories(category),
    searchMemories: (query, category) => app.searchMemories(query, category),
    modelFor: (providerId) => app.modelFor(providerId),
    generate: (options = {}) => app.generate({ ...options, authorization }),
  });
}

const AMBIENT_NAMES = ['process', 'globalThis', 'global', 'require', 'module', 'exports', '__dirname', '__filename'];

export async function executeSkill(skill, input = '', app, { authorization } = {}) {
  const startTime = Date.now();
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    // Skill bodies reach application state through the bounded context; the common
    // ambient names are shadowed so that context is the interface they find.
    const body = skill.code.trim().startsWith('async function') || skill.code.trim().startsWith('function')
      ? `return (${skill.code.trim()})(ctx);`
      : `const { input, app } = ctx;\n${skill.code}`;
    const fn = new AsyncFunction('ctx', ...AMBIENT_NAMES, body);
    const result = await fn({ input, app: createSkillContext(app, { authorization }) }, ...AMBIENT_NAMES.map(() => undefined));
    const output = typeof result === 'string' ? result : (result?.output || JSON.stringify(result, null, 2));
    return {
      success: true,
      slashCommand: skill.slashCommand,
      skillName: skill.name,
      output,
      result,
      durationMs: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      slashCommand: skill.slashCommand,
      skillName: skill.name,
      output: `Skill Execution Error in ${skill.slashCommand}: ${error.message}`,
      error: error.message,
      durationMs: Date.now() - startTime
    };
  }
}
