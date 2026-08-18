import { BaseProvider } from './base.mjs';

export class OllamaProvider extends BaseProvider {
  constructor(config) { super({ ...config, id: config.id || 'ollama', label: config.label || config.name || 'Ollama' }); }
  async listModels() {
    const data = await (await this.safeFetch(`${this.baseUrl}/api/tags`)).json();
    return (data.models || []).map((m) => m.name);
  }
  async *streamChat({ messages, model, signal }) {
    const response = await this.safeFetch(`${this.baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: model || this.model, messages, stream: true }), signal });
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) if (line.trim()) { const event = JSON.parse(line); if (event.message?.content) yield event.message.content; }
    }
  }
}
