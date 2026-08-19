#!/usr/bin/env node
// A minimal, real MCP server over the stdio transport, used to test
// lib/mcp-stdio.mjs against actual JSON-RPC-over-stdio traffic rather than a
// mock. Speaks just enough of the protocol to be a faithful fixture:
// initialize, tools/list, and tools/call for two tools ('echo' and 'boom').

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let index;
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
  }
});

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function handle(message) {
  if (message.method === 'initialize') {
    reply(message.id, { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1.0.0' } });
    return;
  }
  if (message.method === 'notifications/initialized') return; // no reply expected
  if (message.method === 'tools/list') {
    reply(message.id, {
      tools: [
        { name: 'echo', description: 'Echoes back the given text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
        { name: 'boom', description: 'Always reports a tool error.', inputSchema: { type: 'object', properties: {} } },
      ],
    });
    return;
  }
  if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params || {};
    if (name === 'echo') { reply(message.id, { content: [{ type: 'text', text: `echo: ${args?.text ?? ''}` }] }); return; }
    if (name === 'boom') { reply(message.id, { isError: true, content: [{ type: 'text', text: 'boom failed on purpose' }] }); return; }
    reply(message.id, { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] });
    return;
  }
}
