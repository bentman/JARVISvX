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

// A shared harness for the remaining R06 contracts. `respond` decides what the
// stubbed upstream does so one server can play every protocol.
async function withUpstream(respond, run) {
  const captured = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (req.method === 'POST') captured.push({ url: req.url, body: JSON.parse(raw || '{}') });
      respond(req, res);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`, captured); } finally { server.close(); }
}

const adapters = (baseUrl) => [
  ['openai-compat', new OpenAICompatProvider({ baseUrl: `${baseUrl}/v1`, apiKey: 'k' })],
  ['azure-openai', new AzureOpenAIProvider({ baseUrl: `${baseUrl}/v1`, apiKey: 'k' })],
  ['ollama', new OllamaProvider({ baseUrl })],
  ['anthropic', new AnthropicProvider({ baseUrl, apiKey: 'k' })],
  ['gemini', new GeminiProvider({ baseUrl, apiKey: 'k' })],
];

const drain = async (provider, request) => { for await (const piece of provider.streamChat(request)) void piece; };

test('every provider protocol sends the model it was given and keeps conversation roles distinct', async () => {
  await withUpstream((req, res) => {
    if (req.url.startsWith('/api/chat')) { res.writeHead(200, { 'content-type': 'application/x-ndjson' }); return res.end('{"done":true}\n'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: [DONE]\n\n');
  }, async (baseUrl, captured) => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ];

    for (const [name, provider] of adapters(baseUrl)) {
      await drain(provider, { messages, model: 'explicit-model' });
      const { url, body } = captured.at(-1);

      // Gemini names the model in its path; the rest carry it in the body.
      if (name === 'gemini') assert.match(url, /explicit-model/, `${name} should request the explicit model`);
      else assert.equal(body.model, 'explicit-model', `${name} should request the explicit model`);

      const roles = name === 'gemini'
        ? body.contents.map((entry) => entry.role)
        : body.messages.map((message) => message.role);
      assert.equal(roles.length, 3, `${name} should keep every turn`);
      assert.notEqual(roles[0], roles[1], `${name} should not collapse a user and an assistant turn into one role`);
      assert.equal(roles[0], roles[2], `${name} should give both user turns the same role`);
    }
  });
});

test('every provider protocol surfaces an upstream failure as a provider error', async () => {
  await withUpstream((_req, res) => {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'upstream exploded' }));
  }, async (baseUrl) => {
    for (const [name, provider] of adapters(baseUrl)) {
      await assert.rejects(
        drain(provider, { messages: [{ role: 'user', content: 'hi' }], model: 'm' }),
        (error) => {
          assert.match(error.message, /500|exploded|unavailable/i, `${name} should report the upstream failure`);
          return true;
        },
        `${name} should reject rather than yield nothing`
      );
    }
  });
});

test('every provider protocol stops streaming when its turn is cancelled', async () => {
  const sockets = [];
  await withUpstream((req, res) => {
    sockets.push(res);
    // Hold the stream open so only cancellation can end it.
    const ndjson = req.url.startsWith('/api/chat');
    res.writeHead(200, { 'content-type': ndjson ? 'application/x-ndjson' : 'text/event-stream' });
    res.write(ndjson ? '{"message":{"content":"partial"}}\n' : 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  }, async (baseUrl) => {
    for (const [name, provider] of adapters(baseUrl)) {
      const controller = new AbortController();
      const stream = provider.streamChat({ messages: [{ role: 'user', content: 'hi' }], model: 'm', signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await assert.rejects(
        (async () => { for await (const piece of stream) void piece; })(),
        `${name} should end the turn when its signal aborts`
      );
    }
    for (const res of sockets) res.end();
  });
});
