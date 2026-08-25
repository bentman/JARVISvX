import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { OpenAICompatProvider } from '../lib/providers/openai-compat.mjs';
import { AzureOpenAIProvider } from '../lib/providers/azure-openai.mjs';
import { OllamaProvider } from '../lib/providers/ollama.mjs';
import { AnthropicProvider } from '../lib/providers/anthropic.mjs';
import { GeminiProvider } from '../lib/providers/gemini.mjs';

test('openai-compat provider lists models and parses OpenAI SSE tokens', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    if (req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
      return res.end('data: [DONE]\n\n');
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const provider = new OpenAICompatProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model' });
  assert.deepEqual(await provider.listModels(), ['test-model']);
  let reply = '';
  for await (const token of provider.streamChat({ messages: [{ role: 'user', content: 'Hi' }] })) reply += token;
  assert.equal(reply, 'Hello world');
});

// Each protocol carries the canonical system instruction in its own field. A
// captured request per adapter is the only way to see that it landed correctly.
test('every provider protocol encodes the canonical system instruction in its own place', async (t) => {
  const captured = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (req.method === 'POST') captured.push({ url: req.url, body: JSON.parse(raw || '{}') });
      // Ollama streams newline-delimited JSON; the others stream SSE.
      if (req.url.startsWith('/api/chat')) {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        return res.end('{"done":true}\n');
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const system = '=== MEMORY CONTEXT ===\n- [CODE_CONTEXT] stack: Node';
  const messages = [{ role: 'user', content: 'Hi' }];
  const drain = async (provider) => { for await (const piece of provider.streamChat({ messages, system, model: 'm' })) void piece; };

  await drain(new OpenAICompatProvider({ baseUrl: `${baseUrl}/v1` }));
  const openai = captured.at(-1).body;
  assert.deepEqual(openai.messages[0], { role: 'system', content: system });
  assert.equal(openai.messages[1].content, 'Hi');

  await drain(new AzureOpenAIProvider({ baseUrl: `${baseUrl}/v1` }));
  assert.deepEqual(captured.at(-1).body.messages[0], { role: 'system', content: system }, 'Azure inherits the OpenAI encoding');

  await drain(new OllamaProvider({ baseUrl }));
  assert.deepEqual(captured.at(-1).body.messages[0], { role: 'system', content: system });

  await drain(new AnthropicProvider({ baseUrl }));
  const anthropic = captured.at(-1).body;
  assert.equal(anthropic.system, system, 'Anthropic uses its top-level system field');
  assert.ok(!anthropic.messages.some((m) => m.role === 'system'), 'and never a system role in messages');

  await drain(new GeminiProvider({ baseUrl }));
  const gemini = captured.at(-1).body;
  assert.deepEqual(gemini.systemInstruction, { parts: [{ text: system }] });
  assert.equal(gemini.contents.length, 1, 'the instruction is not smuggled in as a user turn');

  // Without an instruction the field is simply absent.
  for (const provider of [new AnthropicProvider({ baseUrl }), new GeminiProvider({ baseUrl })]) {
    for await (const piece of provider.streamChat({ messages, model: 'm' })) void piece;
    const body = captured.at(-1).body;
    assert.ok(!('system' in body) && !('systemInstruction' in body));
  }
});
