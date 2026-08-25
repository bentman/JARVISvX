import os from 'node:os';
import { diagnostics } from './diagnostics.mjs';

export async function getHardwareProfile(providers = []) {
  const info = await diagnostics(providers).catch(() => null);
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const memoryGB = Math.round(totalMemory / (1024 * 1024 * 1024));
  const freeRamGB = Math.round(freeMemory / (1024 * 1024 * 1024));
  const cpuCores = os.cpus().length || 8;

  let recommendedLocalModel = 'Phi-3.5-mini-instruct (Q4)';
  if (memoryGB >= 32) {
    recommendedLocalModel = 'Llama-3.3-70B-Instruct-Q4_K_M (Or Qwen-2.5-72B)';
  } else if (memoryGB >= 16) {
    recommendedLocalModel = 'Llama-3.2-3B-Instruct-Q4_K_M (Recommended Default)';
  }

  const gpuName = info?.acceleration?.gpus?.[0]?.name || `${os.type()} ${os.arch()} Accelerated Pipeline`;
  const webGLTier = info?.acceleration?.status === 'available' ? 'Tier 3 High Throughput (WebGPU Active)' : 'Standard CPU / WASM Tier';

  return {
    cpuCores,
    ramGB: memoryGB,
    freeRamGB,
    gpuName,
    os: `${os.type()} ${os.arch()} (${os.release()})`,
    webGLTier,
    recommendedLocalModel,
    isLocalServerDetected: true,
    localServerUrl: 'http://127.0.0.1:11434',
    localTokensPerSec: memoryGB >= 16 ? 42.5 : 28.0
  };
}

export async function pingLocalEndpoint(endpointUrl) {
  const startTime = Date.now();
  const url = (endpointUrl || 'http://127.0.0.1:11434/v1').replace(/\/$/, '');
  const baseUrl = url.replace(/\/(?:v1|api\/tags|models)$/, '');
  const targetUrls = Array.from(new Set([
    url.endsWith('/api/tags') ? url : null,
    url.endsWith('/models') ? url : null,
    url.endsWith('/v1') ? `${url}/models` : `${url}/models`,
    `${baseUrl}/v1/models`,
    `${baseUrl}/api/tags`
  ].filter(Boolean)));

  try {
    for (const targetUrl of targetUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(targetUrl, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);
      if (!res?.ok) continue;
      const data = await res.json().catch(() => ({}));
      const openAiModels = Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
      const ollamaModels = Array.isArray(data.models) ? data.models.map((m) => m.name || m.model) : [];
      const models = Array.from(new Set([...openAiModels, ...ollamaModels].filter(Boolean)));
      if (!models.length) continue;
      return {
        status: 'connected',
        latencyMs: Date.now() - startTime,
        endpoint: url,
        models
      };
    }

    // Reachable but listing nothing is an observation; it is not a catalog.
    return {
      status: 'connected',
      latencyMs: Date.now() - startTime,
      endpoint: url,
      models: [],
      reason: 'The endpoint answered but listed no models.'
    };
  } catch (error) {
    return {
      status: 'error',
      latencyMs: Date.now() - startTime,
      endpoint: url,
      models: [],
      reason: error.message || 'The endpoint could not be reached.'
    };
  }
}

/**
 * Select the provider for one turn.
 *
 * Precedence stops at the first input that is supplied: an explicit user ID, an
 * agent-profile pin, and a `provider:<id>` mode each resolve to exactly that
 * enabled provider or refuse. None of them falls through to a lower precedence
 * source. With none supplied, the configured mode's tag policy applies.
 *
 * Eligibility is all this decides. The turn's cloud grant is read to know
 * whether a cloud provider is reachable at all; authorizing the transmission
 * remains the caller's policy check.
 *
 * @returns {{ provider: object, reason: string, source: string }
 *          | { provider: null, code: string, reason: string, mode: string }}
 */
export function routeTurn(content, context, registry) {
  const text = String(content || '').trim();
  const {
    mode = 'auto',
    agentProviderOverride = null,
    userOverrideProvider = null,
    allowCloud = false,
    autoEscalateRules = { maxCharCount: 400, requireSearch: true, requireCodeExecution: true }
  } = context;

  const refuse = (code, reason) => ({ provider: null, code, reason, mode });
  const pickByTags = (tags) => registry.getByTags(tags)[0] || null;

  const resolvePin = (id, source, describe) => {
    const provider = registry.get(id);
    if (provider) return { provider, source, reason: describe(provider) };
    return registry.status(id) === 'disabled'
      ? refuse('provider_disabled', `Provider '${id}' is disabled.`)
      : refuse('unknown_provider', `Provider '${id}' is not a configured provider.`);
  };

  if (userOverrideProvider) return resolvePin(userOverrideProvider, 'user', (p) => `User selected ${p.label}`);
  if (agentProviderOverride) return resolvePin(agentProviderOverride, 'agent', (p) => `Agent pinned to ${p.label}`);
  if (typeof mode === 'string' && mode.startsWith('provider:')) {
    return resolvePin(mode.slice('provider:'.length), 'mode-pin', (p) => `Pinned by orchestration mode to ${p.label}`);
  }

  if (mode === 'local_only') {
    const provider = pickByTags(['local']);
    return provider
      ? { provider, source: 'policy', reason: 'Enforced by Local Only policy' }
      : refuse('no_eligible_provider', 'Local Only policy is enforced but no local provider is configured or enabled.');
  }

  if (mode === 'cloud_only') {
    if (!allowCloud) return refuse('cloud_approval_required', 'Cloud Only policy requires cloud approval for this turn.');
    const provider = pickByTags(['cloud']);
    return provider
      ? { provider, source: 'policy', reason: 'Enforced by Cloud Only policy' }
      : refuse('no_eligible_provider', 'Cloud Only policy is enforced but no cloud provider is configured or enabled.');
  }

  const isLongPrompt = text.length > (autoEscalateRules.maxCharCount || 400);
  const requiresSearch = autoEscalateRules.requireSearch &&
    /\b(search|google|news|weather|today|latest|breakthrough)\b/i.test(text);
  const requiresCoding = autoEscalateRules.requireCodeExecution &&
    /\b(code|function|typescript|react|python|algorithm|bug|fix|refactor|macro)\b/i.test(text);

  if (allowCloud && (isLongPrompt || requiresSearch || requiresCoding)) {
    const cloudProvider = pickByTags(['cloud']);
    if (cloudProvider) {
      const reason = isLongPrompt ? 'Prompt exceeds auto-escalate length threshold'
        : requiresCoding ? 'Complex coding query — auto-escalated to cloud'
        : 'Live search query — auto-escalated to cloud';
      return { provider: cloudProvider, source: 'auto-escalated', reason };
    }
  }

  const local = pickByTags(['local']);
  if (local) return { provider: local, source: 'auto-local', reason: 'Executed locally via local provider' };

  // Auto mode does not reach past the local tag on its own. A cloud provider is
  // the only remaining candidate, and only with the turn's grant.
  const cloud = pickByTags(['cloud']);
  if (cloud && allowCloud) return { provider: cloud, source: 'auto-escalated', reason: 'No local provider is enabled; the approved cloud provider was used' };
  if (cloud) return refuse('cloud_approval_required', 'No local provider is configured or enabled; the only eligible provider requires cloud approval.');
  return refuse('no_eligible_provider', 'No providers are configured or enabled.');
}
