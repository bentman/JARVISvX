import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pingStdio, callStdioTool } from './mcp-stdio.mjs';
import { resolveWithinRoots, selectApprovedRoot } from './tools.mjs';

const execFileAsync = promisify(execFile);

export async function pingMcpServer(server) {
  const startTime = Date.now();
  if (server.endpoint.startsWith('workspace://') || server.endpoint.startsWith('sqlite://') || server.type === 'built-in') {
    return {
      status: 'connected',
      latencyMs: Math.max(1, Date.now() - startTime)
    };
  }
  if (server.type === 'stdio') {
    try {
      await pingStdio(server.endpoint);
      return { status: 'connected', latencyMs: Date.now() - startTime };
    } catch {
      return { status: 'error', latencyMs: Date.now() - startTime };
    }
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(server.endpoint, { signal: controller.signal }).catch(() => null);
    clearTimeout(timeout);
    return {
      status: res && (res.ok || res.status < 500) ? 'connected' : 'error',
      latencyMs: Date.now() - startTime
    };
  } catch (e) {
    return { status: 'error', latencyMs: Date.now() - startTime };
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

    // Generic HTTP JSON-RPC execution for external server endpoints
    if (server.endpoint && (server.endpoint.startsWith('http://') || server.endpoint.startsWith('https://'))) {
      const response = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: `tools/call`,
          params: { name: toolName, arguments: params },
          id: Date.now()
        })
      });
      const data = await response.json();
      return {
        success: true,
        tool: toolName,
        output: typeof data.result === 'string' ? data.result : JSON.stringify(data.result || data, null, 2),
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
