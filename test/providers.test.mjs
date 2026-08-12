import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { LlamaCppProvider } from '../lib/providers.mjs';

test('llama.cpp provider lists models and parses OpenAI SSE tokens', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    if (req.url === '/v1/chat/completions') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'); res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n'); return res.end('data: [DONE]\n\n'); }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address(); const provider = new LlamaCppProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model' });
  assert.deepEqual(await provider.listModels(), ['test-model']);
  let reply = ''; for await (const token of provider.streamChat({ messages: [{ role: 'user', content: 'Hi' }] })) reply += token;
  assert.equal(reply, 'Hello world');
});

