import { BaseProvider } from './base.mjs';

export class OllamaProvider extends BaseProvider {
  constructor(config) { super({ ...config, id: config.id || 'ollama', label: config.label || config.name || 'Ollama' }); }
  get supportsToolCalling() { return true; }
  async listModels() {
    const data = await (await this.safeFetch(`${this.baseUrl}/api/tags`)).json();
    return (data.models || []).map((m) => m.name);
  }
  async *streamChat({ messages, model, signal, tools }) {
    const body = { model: model || this.model, messages: toOllamaMessages(messages), stream: true };
    if (tools?.length) body.tools = tools.map(toOllamaTool);
    const response = await this.safeFetch(`${this.baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.message?.content) yield event.message.content;
        for (const call of event.message?.tool_calls || []) {
          const name = call.function?.name; if (!name) continue;
          yield { type: 'tool_call', id: crypto.randomUUID(), name, arguments: normalizeArguments(call.function?.arguments) };
        }
      }
    }
  }
}

// Ollama's native API returns tool-call arguments as a plain object already
// (unlike OpenAI, which streams them as concatenated JSON-string fragments),
// but this tolerates a string too in case that changes.
function normalizeArguments(args) {
  if (!args) return {};
  if (typeof args === 'string') { try { return JSON.parse(args); } catch { return {}; } }
  return args;
}

function toOllamaTool(tool) {
  return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

// See openai-compat.mjs's toOpenAiMessages for what the `toolCalls` /
// `role: 'tool'` shapes mean in the canonical history.
function toOllamaMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return { role: 'assistant', content: m.content || '', tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.arguments || {} } })) };
    }
    return { role: m.role, content: m.content };
  });
}
