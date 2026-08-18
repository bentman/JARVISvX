import { OpenAICompatProvider } from './openai-compat.mjs';

// Azure OpenAI / Azure AI Foundry — uses api-key header in addition to Bearer.
// Both header styles are sent so the same config works with both Azure OpenAI
// service deployments (api-key only) and Azure AI Foundry (Bearer or api-key).
export class AzureOpenAIProvider extends OpenAICompatProvider {
  constructor(config) { super({ ...config, id: config.id || 'azure-openai', label: config.label || config.name || 'Azure OpenAI' }); }
  get jsonHeaders() {
    const h = super.jsonHeaders;
    if (this.apiKey) h['api-key'] = this.apiKey;
    return h;
  }
}
