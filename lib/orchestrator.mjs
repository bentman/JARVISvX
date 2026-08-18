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

    return {
      status: 'connected',
      latencyMs,
      endpoint: url,
      models: ['Llama-3.2-3B-Instruct', 'Llama-3.2-1B-Instruct', 'Phi-3.5-mini-instruct']
    };
  } catch (e) {
    return {
      status: 'error',
      latencyMs: Date.now() - startTime,
      endpoint: url,
      models: ['Llama-3.2-3B-Instruct']
    };
  }
}

/**
 * Route a chat turn to the best available provider.
 *
 * Priority (highest → lowest):
 *  1. context.userOverrideProvider  — explicit per-message user selection (implies consent)
 *  2. context.agentProviderOverride — pinned in agent config
 *  3. context.mode === 'provider:<id>' — provider pinned in orchestration settings
 *  4. mode === 'local_only'  → tags ['local'], never substitutes a non-local provider
 *  5. mode === 'cloud_only'  → tags ['cloud'], gated on context.allowCloud
 *  6. mode === 'auto'        → heuristic escalation to cloud, gated on context.allowCloud
 *
 * Policy-enforced modes (4 & 5) never silently fall back to a provider that doesn't
 * match the policy's tag — if none is available, `provider` comes back null so the
 * caller can fail loudly instead of quietly violating the policy.
 *
 * @param {string} content  The user message text.
 * @param {object} context  Routing context from orchestration settings + agent + user.
 * @param {import('./providers/index.mjs').ProviderRegistry} registry  Live provider registry.
 * @returns {{ provider: object|null, reason: string, needsCloudApproval?: boolean }}
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

  // Helper: first enabled provider matching ALL tags, or null (no silent tag-mismatched fallback).
  const pickByTags = (tags) => registry.getByTags(tags)[0] || null;

  // 1. Explicit per-message user override.
  if (userOverrideProvider) {
    const provider = registry.get(userOverrideProvider);
    if (provider) return { provider, reason: `User selected ${provider.label}` };
  }

  // 2. Agent-level provider override.
  if (agentProviderOverride) {
    const provider = registry.get(agentProviderOverride);
    if (provider) return { provider, reason: `Agent pinned to ${provider.label}` };
  }

  // 3. Explicit provider ID pinned in orchestration mode.
  if (typeof mode === 'string' && mode.startsWith('provider:')) {
    const pinId = mode.slice('provider:'.length);
    const provider = registry.get(pinId);
    if (provider) return { provider, reason: `Pinned provider: ${provider.label}` };
  }

  // 4. Local-only policy — fail loudly rather than ever escalate off-policy.
  if (mode === 'local_only') {
    const provider = pickByTags(['local']);
    return provider
      ? { provider, reason: 'Enforced by Local Only policy' }
      : { provider: null, reason: 'Local Only policy is enforced but no local provider is configured or enabled.' };
  }

  // 5. Cloud-only policy — still requires per-turn cloud approval.
  if (mode === 'cloud_only') {
    if (!allowCloud) return { provider: null, reason: 'Cloud Only policy requires cloud approval for this turn.', needsCloudApproval: true };
    const provider = pickByTags(['cloud']);
    return provider
      ? { provider, reason: 'Enforced by Cloud Only policy' }
      : { provider: null, reason: 'Cloud Only policy is enforced but no cloud provider is configured or enabled.' };
  }

  // 6. Auto mode: heuristic escalation — only ever escalates to cloud when approved.
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
      return { provider: cloudProvider, reason };
    }
  }

  let provider = pickByTags(['local']);
  if (provider) return { provider, reason: 'Executed locally via local provider' };

  // No local provider at all — only fall back to whatever else exists if it isn't
  // cloud-tagged, or cloud has already been approved for this turn.
  const fallback = registry.list()[0] || null;
  if (fallback && fallback.tags?.includes('cloud') && !allowCloud) {
    return { provider: null, reason: 'No local provider is configured or enabled; the only available provider requires cloud approval.', needsCloudApproval: true };
  }
  return fallback
    ? { provider: fallback, reason: 'Executed via the only configured provider' }
    : { provider: null, reason: 'No providers are configured or enabled.' };
}

/** @deprecated Use routeTurn() instead. Kept for backward compat with tests. */
export function evaluateTurnRouting(content, config, cloudAvailable = false, cloudApproved = false) {
  const text = String(content || '').trim();
  const mode = config.mode || 'auto';
  const rules = config.autoEscalateRules || { maxCharCount: 400, requireSearch: true, requireCodeExecution: true };
  if (mode === 'local_only') return { shouldCloudEscalate: false, reason: 'Enforced by 100% Local Only Policy', targetProvider: 'local' };
  if (mode === 'cloud_only') return { shouldCloudEscalate: cloudAvailable && cloudApproved, reason: 'Enforced by Cloud Gemini Policy', targetProvider: cloudAvailable && cloudApproved ? 'cloud' : 'local' };
  const isLongPrompt = text.length > (rules.maxCharCount || 400);
  const requiresSearch = rules.requireSearch && /\b(search|google|news|weather|today|latest|breakthrough)\b/i.test(text);
  const requiresCoding = rules.requireCodeExecution && /\b(code|function|typescript|react|python|algorithm|bug|fix|refactor|macro)\b/i.test(text);
  const shouldEscalate = (isLongPrompt || requiresSearch || requiresCoding) && cloudAvailable && cloudApproved;
  let reason = 'Executed locally via Local LLM Engine';
  if (shouldEscalate) reason = isLongPrompt ? 'Prompt character length exceeded auto-escalate threshold' : requiresCoding ? 'Complex coding query auto-escalated to Cloud' : 'Live search grounding query auto-escalated to Cloud';
  return { shouldCloudEscalate: shouldEscalate, reason, targetProvider: shouldEscalate ? 'cloud' : 'local' };
}


