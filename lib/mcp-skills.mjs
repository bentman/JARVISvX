import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pingStdio, callStdioTool } from './mcp-stdio.mjs';

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
  const targetDir = roots[0] || process.cwd();

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
      const content = params.content || '';
      if (!filePath) throw new Error('Parameter "path" is required.');
      const resolved = path.resolve(filePath);
      const permitted = roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
      if (!permitted) throw new Error('Target file is outside approved workspace roots.');
      await fs.writeFile(resolved, content, 'utf8');
      return {
        success: true,
        tool: toolName,
        output: `Successfully wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${resolved}`,
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'list_workspace_directory') {
      const relPath = params.path || '';
      const target = relPath ? path.resolve(targetDir, relPath) : targetDir;
      const permitted = roots.some((root) => target === root || target.startsWith(`${root}${path.sep}`));
      if (!permitted && roots.length > 0) throw new Error('Directory is outside approved workspace roots.');
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
      const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], { cwd: targetDir });
      return {
        success: true,
        tool: toolName,
        output: stdout || 'Working tree clean',
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'git_diff') {
      const args = ['diff'];
      if (params.file) args.push(params.file);
      const { stdout } = await execFileAsync('git', args, { cwd: targetDir });
      return {
        success: true,
        tool: toolName,
        output: stdout || 'No uncommitted changes',
        durationMs: Date.now() - startTime
      };
    }

    if (toolName === 'execute_query') {
      const sql = (params.sql || '').trim();
      if (!sql.toLowerCase().startsWith('select') && !sql.toLowerCase().startsWith('pragma')) {
        throw new Error('Only read-only SELECT or PRAGMA queries are permitted.');
      }
      const rows = app.db.db.prepare(sql).all();
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

export async function executeSkill(skill, input = '', app) {
  const startTime = Date.now();
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let fn;
    if (skill.code.trim().startsWith('async function') || skill.code.trim().startsWith('function')) {
      fn = new AsyncFunction('ctx', `return (${skill.code.trim()})(ctx);`);
    } else {
      fn = new AsyncFunction('ctx', `const { input, app } = ctx;\n${skill.code}`);
    }
    const result = await fn({ input, app });
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
