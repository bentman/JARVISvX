import { HEALTH_FRESHNESS_MS, ProviderError } from './base.mjs';
import { OpenAICompatProvider } from './openai-compat.mjs';
import { OllamaProvider } from './ollama.mjs';
import { AzureOpenAIProvider } from './azure-openai.mjs';
import { AnthropicProvider } from './anthropic.mjs';
import { GeminiProvider } from './gemini.mjs';

export { ProviderError } from './base.mjs';

const PROTOCOL_MAP = {
  'openai-compat': OpenAICompatProvider,
  'ollama': OllamaProvider,
  'azure-openai': AzureOpenAIProvider,
  'anthropic': AnthropicProvider,
  'gemini': GeminiProvider,
};

const SUPPORTED_PROTOCOLS = Object.keys(PROTOCOL_MAP);

/**
 * Builds provider instances from database records and reloads them after edits.
 */
export class ProviderRegistry {
  constructor({ database } = {}) {
    this.database = database;
    this._instances = new Map(); // id -> provider instance
    this._health = new Map();    // id -> last measured health result
    this._sortedList = null;
    this._tagCache = new Map();
  }

  /** Load/reload provider instances from DB. Call after any in-app edit. */
  reload() {
    this._instances.clear();
    this._health.clear();
    this._sortedList = null;
    this._tagCache.clear();
    const rows = this.database.providers();
    for (const row of rows) {
      if (!row.enabled) continue;
      const Cls = PROTOCOL_MAP[row.protocol];
      if (!Cls) continue;
      const apiKey = this.database.providerApiKey(row.id);
      const instance = new Cls({
        id: row.id, label: row.name, name: row.name,
        baseUrl: row.base_url, model: row.model,
        apiKey, tags: row.tags, priority: row.priority, protocol: row.protocol,
      });
      this._instances.set(row.id, instance);
    }
    return this;
  }

  /** Get a provider by ID (enabled or disabled lookup — for health checks). */
  get(id) {
    return this._instances.get(id) || null;
  }

  /** Whether an ID names an enabled provider, a disabled one, or nothing at all. */
  status(id) {
    if (this._instances.has(id)) return 'enabled';
    return this.database?.provider(id) ? 'disabled' : 'unknown';
  }

  /** All loaded (enabled) provider instances, sorted by priority then name. */
  list() {
    if (!this._sortedList) {
      this._sortedList = Array.from(this._instances.values())
        .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
    }
    return this._sortedList;
  }

  /**
   * Get the best available provider matching ALL requested tags.
   * Returns providers sorted by priority (lowest number = highest priority).
   * Returns [] if none match.
   */
  getByTags(tags = []) {
    if (!tags.length) return this.list();
    const key = tags.slice().sort().join(',');
    let match = this._tagCache.get(key);
    if (!match) {
      match = this.list().filter((p) => tags.every((tag) => p.tags.includes(tag)));
      this._tagCache.set(key, match);
    }
    return match;
  }

  /** Return first enabled provider by priority, or throw if none exist. */
  getDefault() {
    const first = this.list()[0];
    if (!first) throw new ProviderError('No providers are configured or enabled.', 'no_provider');
    return first;
  }

  /**
   * Health for every enabled provider. A result inside the freshness window is
   * reused; anything older is measured again before it is reported, so an
   * availability claim always rests on a current probe.
   */
  async health() {
    return Promise.all(this.list().map(async (provider) => {
      const cached = this._health.get(provider.id);
      if (cached && Date.now() - Date.parse(cached.checkedAt) < HEALTH_FRESHNESS_MS) return { ...cached, stale: false };
      const measured = await provider.health();
      this._health.set(provider.id, measured);
      return { ...measured, stale: false };
    }));
  }

  /** Instantiate a one-off provider from a DB row (for health-check of disabled ones). */
  instanceFromRow(row) {
    const Cls = PROTOCOL_MAP[row.protocol];
    if (!Cls) return null;
    const apiKey = this.database.providerApiKey(row.id);
    return new Cls({ id: row.id, label: row.name, name: row.name, baseUrl: row.base_url, model: row.model, apiKey, tags: row.tags, priority: row.priority, protocol: row.protocol });
  }

  /**
   * Instantiate a transient provider from unsaved connection fields.
   */
  static instanceFromConfig({ protocol, baseUrl, apiKey }) {
    const Cls = PROTOCOL_MAP[protocol];
    if (!Cls) return null;
    return new Cls({ id: 'probe', label: 'Probe', baseUrl, apiKey, protocol });
  }
}
