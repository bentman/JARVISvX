import { BaseProvider, ProviderError } from './base.mjs';

export class OpenAICompatProvider extends BaseProvider {
  constructor(config) { super({ ...config, id: config.id || 'openai-compat', label: config.label || config.name || 'OpenAI-compatible' }); }
  get supportsToolCalling() { return true; }
  async listModels(signal) {
    const data = await (await this.safeFetch(`${this.baseUrl}/models`, { headers: this.jsonHeaders, signal })).json();
    return (data.data || []).map((m) => m.id);
  }
  async *streamChat({ messages, system, model, signal, tools }) {
    const conversation = system ? [{ role: 'system', content: system }, ...messages] : messages;
    const body = { model: model || this.model, messages: toOpenAiMessages(conversation), stream: true };
    if (tools?.length) { body.tools = tools.map(toOpenAiTool); body.tool_choice = 'auto'; }
    const response = await this.safeFetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.jsonHeaders, body: JSON.stringify(body), signal });
    yield* openAiStream(response, signal);
  }
}

// Canonical history uses { role, content } for plain turns, plus two shapes
// specific to tool use: an assistant turn that requested tools carries
// `toolCalls` ([{ id, name, arguments }]); the tool's own result comes back
// as `{ role: 'tool', toolCallId, content }`. Both translate to OpenAI's
// wire format here rather than living in the shared history shape, since
// each provider protocol represents a tool round differently.
function toOpenAiMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } })) };
    }
    return { role: m.role, content: m.content };
  });
}

function toOpenAiTool(tool) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

export async function* openAiStream(response, signal) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  const toolCalls = new Map(); // delta index -> accumulated { id, name, arguments }
  while (true) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n'); buffer = blocks.pop();
    for (const block of blocks) {
      let line;
      if (block.startsWith('data:')) {
        const newlineIdx = block.indexOf('\n');
        line = newlineIdx === -1 ? block : block.slice(0, newlineIdx);
      } else {
        const dataIdx = block.indexOf('\ndata:');
        if (dataIdx === -1) continue;
        const start = dataIdx + 1;
        const newlineIdx = block.indexOf('\n', start);
        line = newlineIdx === -1 ? block.slice(start) : block.slice(start, newlineIdx);
      }
      const payload = line.slice(5).trim(); if (payload === '[DONE]') { yield* flushToolCalls(toolCalls); return; }
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      const delta = event.choices?.[0]?.delta;
      if (delta?.content) yield delta.content;
      for (const call of delta?.tool_calls || []) {
        const idx = call.index ?? 0;
        const existing = toolCalls.get(idx) || { id: call.id, name: '', arguments: '' };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name += call.function.name;
        if (call.function?.arguments) existing.arguments += call.function.arguments;
        toolCalls.set(idx, existing);
      }
    }
  }
  yield* flushToolCalls(toolCalls);
}

// Tool-call arguments stream in as concatenated JSON-string fragments, keyed by
// index, across multiple deltas — this assembles and parses them once the
// stream ends (naturally, or via [DONE]) into one 'tool_call' piece per call.
function* flushToolCalls(toolCalls) {
  for (const [, call] of toolCalls) {
    if (!call.name) continue;
    let args = {};
    try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = {}; }
    yield { type: 'tool_call', id: call.id || crypto.randomUUID(), name: call.name, arguments: args };
  }
  toolCalls.clear();
}
