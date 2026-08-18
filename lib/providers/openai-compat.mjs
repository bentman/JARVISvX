import { BaseProvider, ProviderError } from './base.mjs';

export class OpenAICompatProvider extends BaseProvider {
  constructor(config) { super({ ...config, id: config.id || 'openai-compat', label: config.label || config.name || 'OpenAI-compatible' }); }
  async listModels() {
    const data = await (await this.safeFetch(`${this.baseUrl}/models`, { headers: this.jsonHeaders })).json();
    return (data.data || []).map((m) => m.id);
  }
  async *streamChat({ messages, model, signal }) {
    const response = await this.safeFetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.jsonHeaders, body: JSON.stringify({ model: model || this.model, messages, stream: true }), signal });
    yield* openAiStream(response, signal);
  }
}

export async function* openAiStream(response, signal) {
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  while (true) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n'); buffer = blocks.pop();
    for (const block of blocks) {
      const line = block.split('\n').find((e) => e.startsWith('data:')); if (!line) continue;
      const payload = line.slice(5).trim(); if (payload === '[DONE]') return;
      const event = JSON.parse(payload); const token = event.choices?.[0]?.delta?.content; if (token) yield token;
    }
  }
}
