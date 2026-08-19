import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { listStdioTools, callStdioTool } from '../lib/mcp-stdio.mjs';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mcp-stdio-server.mjs');
const command = `node "${fixture}"`;

test('listStdioTools performs a real initialize + tools/list handshake against a live stdio process', async () => {
  const tools = await listStdioTools(command);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.ok(byName.echo, 'echo tool should be discovered');
  assert.equal(byName.echo.parameters, 'text: string');
  assert.ok(byName.boom, 'boom tool should be discovered');
});

test('callStdioTool performs a real tools/call and returns the server\'s text output', async () => {
  const output = await callStdioTool(command, 'echo', { text: 'hello there' });
  assert.equal(output, 'echo: hello there');
});

test('callStdioTool surfaces a real isError result as a rejected promise', async () => {
  await assert.rejects(callStdioTool(command, 'boom', {}), /boom failed on purpose/);
});

test('a command that cannot be spawned fails clearly instead of hanging or reporting fake success', async () => {
  await assert.rejects(
    listStdioTools('definitely_missing_jarvisvx_mcp_binary'),
    /Could not start the MCP server command/
  );
});
