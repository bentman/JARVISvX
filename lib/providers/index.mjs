import { ProviderError } from './base.mjs';
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

export const SUPPORTED_PROTOCOLS = Object.keys(PROTOCOL_MAP);

/**
 * ProviderRegistry — builds and manages provider instances from DB records.
 *
 * Replaces the old static 3-provider array. Supports hot-reload (reload())
 * so in-app edits take effect immediately without a daemon restart.
 */
export class ProviderRegistry {
  constructor({ database } = {}) {
    this.database = database;
    this._instances = new Map(); // id -> provider instance
  }

  /** Load/reload provider instances from DB. Call after any in-app edit. */
  reload() {
    this._instances.clear();
    const rows = this.database.providers();
    for (const row of rows) {
      if (!row.enabled) continue;
      const Cls = PROTOCOL_MAP[row.protocol];
      if (!Cls) continue;
      const apiKey = this.database.providerApiKey(row.id);
      const instance = new Cls({
        id: row.id, label: row.name, name: row.name,
        baseUrl: row.base_url, model: row.model,
        apiKey, tags: row.tags, priority: row.priority,
      });
      this._instances.set(row.id, instance);
    }
    return this;
  }

  /** Get a provider by ID (enabled or disabled lookup — for health checks). */
  get(id) {
    return this._instances.get(id) || null;
  }

  /** All loaded (enabled) provider instances, sorted by priority then name. */
  list() {
    return Array.from(this._instances.values())
      .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  }

  /**
   * Get the best available provider matching ALL requested tags.
   * Returns providers sorted by priority (lowest number = highest priority).
   * Returns [] if none match.
   */
  getByTags(tags = []) {
    if (!tags.length) return this.list();
    return this.list().filter((p) => tags.every((tag) => p.tags.includes(tag)));
  }

  /** Return first enabled provider by priority, or throw if none exist. */
  getDefault() {
    const first = this.list()[0];
    if (!first) throw new ProviderError('No providers are configured or enabled.', 'no_provider');
    return first;
  }

  /** Health check all providers concurrently. */
  async health() {
    return Promise.all(this.list().map((p) => p.health()));
  }

  /** Instantiate a one-off provider from a DB row (for health-check of disabled ones). */
  instanceFromRow(row) {
    const Cls = PROTOCOL_MAP[row.protocol];
    if (!Cls) return null;
    const apiKey = this.database.providerApiKey(row.id);
    return new Cls({ id: row.id, label: row.name, name: row.name, baseUrl: row.base_url, model: row.model, apiKey, tags: row.tags, priority: row.priority });
  }
}
