import { BaseProvider, ProviderError } from './base.mjs';

export class AnthropicProvider extends BaseProvider {
  constructor(config) { super({ ...config, id: config.id || 'anthropic', label: config.label || config.name || 'Anthropic' }); this.baseUrl = this.baseUrl || 'https://api.anthropic.com'; }
  get anthropicHeaders() { return { 'content-type': 'application/json', 'x-api-key': this.apiKey || '', 'anthropic-version': '2023-06-01' }; }
  // A local catalog for model selection; it says nothing about availability.
  async listModels() {
    return ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'];
  }
  async probe(signal) {
    if (!this.apiKey) { const failure = new ProviderError('No API key is configured.', 'not_configured'); failure.status = 401; throw failure; }
    await this.safeFetch(`${this.baseUrl}/v1/models`, { headers: this.anthropicHeaders, signal });
    return { models: await this.listModels(signal) };
  }
  async *streamChat({ messages, system, model, signal }) {
    const body = { model: model || this.model || 'claude-sonnet-4-5', max_tokens: 8192, messages, stream: true };
    if (system) body.system = system;
    const response = await this.safeFetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST', headers: this.anthropicHeaders, signal, body: JSON.stringify(body)
    });
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim(); if (!payload || payload === '[DONE]') continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') yield event.delta.text;
        } catch {}
      }
    }
  }
}
