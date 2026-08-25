import { BaseProvider, ProviderError } from './base.mjs';

export class GeminiProvider extends BaseProvider {
  constructor(config) { super({ ...config, id: config.id || 'gemini', label: config.label || config.name || 'Google Gemini' }); this.baseUrl = this.baseUrl || 'https://generativelanguage.googleapis.com'; }
  // A local catalog for model selection; it says nothing about availability.
  async listModels() { return ['gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.5-flash']; }
  async probe() {
    if (!this.apiKey) { const failure = new ProviderError('No API key is configured.', 'not_configured'); failure.status = 401; throw failure; }
    await this.safeFetch(`${this.baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`);
    return { models: await this.listModels() };
  }
  async *streamChat({ messages, system, model, signal }) {
    const mdl = model || this.model || 'gemini-2.0-flash';
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const body = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const url = `${this.baseUrl}/v1beta/models/${mdl}:streamGenerateContent?alt=sse&key=${this.apiKey || ''}`;
    const response = await this.safeFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim(); if (!payload) continue;
        try { const event = JSON.parse(payload); const text = event.candidates?.[0]?.content?.parts?.[0]?.text; if (text) yield text; } catch {}
      }
    }
  }
}
