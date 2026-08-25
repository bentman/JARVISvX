const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

export class ProviderError extends Error {
  constructor(message, code = 'provider_error') { super(message); this.code = code; }
}

// An adapter's streamChat() receives the canonical system instruction as `system`,
// separate from conversation `messages`, and encodes it in its own protocol.
export class BaseProvider {
  constructor({ id, label, baseUrl, model = '', apiKey = null, tags = [], priority = 50, protocol = null }) {
    Object.assign(this, { id, label, baseUrl: baseUrl?.replace(/\/$/, ''), model, apiKey, tags, priority, protocol });
  }

  get jsonHeaders() {
    const h = { ...JSON_HEADERS };
    if (this.apiKey) h['authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  // Whether this provider's streamChat() understands a `tools` argument and can
  // yield 'tool_call' pieces. False by default — callers must not send a `tools`
  // payload or a tool-calling system prompt to a provider that hasn't opted in,
  // since some wire protocols (Anthropic's `system` field, Gemini's role mapping)
  // would misinterpret it rather than simply ignore it.
  get supportsToolCalling() { return false; }

  async health() {
    try {
      const models = await this.listModels();
      return { id: this.id, label: this.label, available: true, models, tags: this.tags, priority: this.priority, protocol: this.protocol };
    } catch (error) {
      return { id: this.id, label: this.label, available: false, reason: error.message, models: [], tags: this.tags, priority: this.priority, protocol: this.protocol };
    }
  }

  async safeFetch(url, options = {}) {
    try {
      const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(8000) });
      if (!response.ok) throw new ProviderError(`${this.label} returned ${response.status}: ${await response.text()}`, 'upstream_error');
      return response;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`${this.label} is unavailable: ${error.message}`, 'unavailable');
    }
  }
}
