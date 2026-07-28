const jsonHeaders = { 'content-type': 'application/json', accept: 'application/json' };
export class ProviderError extends Error { constructor(message, code = 'provider_error') { super(message); this.code = code; } }
class BaseProvider {
  constructor({ id, label, baseUrl, model, enabled = true }) { Object.assign(this, { id, label, baseUrl: baseUrl?.replace(/\/$/, ''), model, enabled }); }
  async health() { try { const models = await this.listModels(); return { id: this.id, label: this.label, available: true, models }; } catch (error) { return { id: this.id, label: this.label, available: false, reason: error.message, models: [] }; } }
  async fetch(url, options = {}) { try { const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(8000) }); if (!response.ok) throw new ProviderError(`${this.label} returned ${response.status}: ${await response.text()}`, 'upstream_error'); return response; } catch (error) { if (error instanceof ProviderError) throw error; throw new ProviderError(`${this.label} is unavailable: ${error.message}`, 'unavailable'); } }
}
export class LlamaCppProvider extends BaseProvider {
  constructor(config = {}) { super({ id: 'llamacpp', label: 'llama.cpp / llama.app', baseUrl: config.baseUrl || process.env.JARVIS_LLAMACPP_URL || 'http://127.0.0.1:8080/v1', model: config.model }); }
  async listModels() { const data = await (await this.fetch(`${this.baseUrl}/models`)).json(); return (data.data || []).map((model) => model.id); }
  async *streamChat({ messages, model, signal }) { const response = await this.fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ model: model || this.model, messages, stream: true }), signal }); yield* openAiStream(response, signal); }
}
export class OllamaProvider extends BaseProvider {
  constructor(config = {}) { super({ id: 'ollama', label: 'Ollama', baseUrl: config.baseUrl || process.env.JARVIS_OLLAMA_URL || 'http://127.0.0.1:11434', model: config.model }); }
  async listModels() { const data = await (await this.fetch(`${this.baseUrl}/api/tags`)).json(); return (data.models || []).map((model) => model.name); }
  async *streamChat({ messages, model, signal }) { const response = await this.fetch(`${this.baseUrl}/api/chat`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ model: model || this.model, messages, stream: true }), signal }); const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) if (line.trim()) { const event = JSON.parse(line); if (event.message?.content) yield event.message.content; } } }
}
export class OpenAICompatibleCloudProvider extends LlamaCppProvider {
  constructor(config = {}) { super({ baseUrl: config.baseUrl || process.env.JARVIS_CLOUD_URL, model: config.model || process.env.JARVIS_CLOUD_MODEL }); this.id = 'cloud'; this.label = 'OpenAI-compatible cloud'; this.apiKey = config.apiKey || process.env.JARVIS_CLOUD_API_KEY; this.enabled = Boolean(this.baseUrl && this.model && this.apiKey); }
  async fetch(url, options = {}) { if (!this.enabled) throw new ProviderError('Cloud provider is not configured.', 'not_configured'); return super.fetch(url, { ...options, headers: { ...options.headers, authorization: `Bearer ${this.apiKey}` } }); }
}
async function* openAiStream(response, signal) { const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; while (true) { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const blocks = buffer.split('\n\n'); buffer = blocks.pop(); for (const block of blocks) { const line = block.split('\n').find((entry) => entry.startsWith('data:')); if (!line) continue; const payload = line.slice(5).trim(); if (payload === '[DONE]') return; const event = JSON.parse(payload); const token = event.choices?.[0]?.delta?.content; if (token) yield token; } } }
