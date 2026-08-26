const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' };

// How long a measured health result is treated as current.
export const HEALTH_FRESHNESS_MS = 30_000;

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

  // The live operation that establishes availability. For protocols whose model
  // list is a real request this is that request; a protocol with a local catalog
  // overrides it with a bounded credential and endpoint check.
  async probe(signal) {
    return { models: await this.listModels(signal) };
  }

  // Availability is measured, never assumed, and says which of the four states
  // the probe observed.
  async health(signal) {
    const checkedAt = new Date().toISOString();
    const identity = { id: this.id, label: this.label, tags: this.tags, priority: this.priority, protocol: this.protocol, checkedAt };
    if (!this.baseUrl) return { ...identity, available: false, state: 'not_configured', reason: 'No base URL is configured.', models: [] };
    try {
      const { models = [] } = await this.probe(signal);
      return { ...identity, available: true, state: 'available', models };
    } catch (error) {
      const state = error.status === 401 || error.status === 403 ? 'auth_error' : 'unreachable';
      return { ...identity, available: false, state, reason: error.message, models: [] };
    }
  }

  async safeFetch(url, options = {}) {
    try {
      const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(8000) });
      if (!response.ok) {
        const failure = new ProviderError(`${this.label} returned ${response.status}: ${await response.text()}`, 'upstream_error');
        failure.status = response.status;
        throw failure;
      }
      return response;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`${this.label} is unavailable: ${error.message}`, 'unavailable');
    }
  }
}
