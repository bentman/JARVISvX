import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { ModelConfig, ProviderRecord } from '../types';
import {
  Cpu,
  Server,
  Sparkles,
  Sliders,
  CheckCircle2,
  RefreshCw,
  Globe,
  X
} from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { ToastStack } from './ui/ToastStack';
import { useToast } from '../hooks/useToast';

const mergeModels = (...groups: string[][]) => Array.from(new Set(groups.flat().filter(Boolean)));

// A provider counts as "local" for this panel's purposes if it's Ollama-protocol,
// or openai-compat tagged 'local' (i.e. llama.cpp/llama.app-style endpoints).
const isLocalProvider = (p: ProviderRecord) => p.protocol === 'ollama' || (p.protocol === 'openai-compat' && p.tags?.includes('local'));

async function discoverModelsFor(providers: ProviderRecord[]): Promise<string[]> {
  const results = await Promise.all(providers.map((p) => api.models(p.id).then((res) => res.models).catch(() => [])));
  return mergeModels(...results);
}

export function ModelOrchestrationView({
  onProvidersChanged,
  onOpenProviders
}: {
  // Called after any change here that other panels (Settings' Active
  // Provider/Model dropdowns, the Providers "Active" badge) also display, so
  // every surface reflects the same single result instead of going stale
  // until an unrelated refresh happens to fire.
  onProvidersChanged?: () => void;
  onOpenProviders?: () => void;
} = {}) {
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    mode: 'auto',
    localEndpoint: 'http://127.0.0.1:11434/v1',
    selectedLocalModel: 'Llama-3.2-3B-Instruct',
    autoEscalateRules: {
      maxCharCount: 400,
      requireSearch: true,
      requireCodeExecution: true
    }
  });

  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  // The real active provider id, from the same authoritative source every
  // other panel reads — not a hardcoded protocol name like 'llamacpp'.
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  // Real installed providers, split by the same 'local'/'cloud' tags the
  // Providers panel and routeTurn() both use — backs the endpoint selector
  // below and the "MAX POWER" card, instead of a free-typed URL or a
  // hardcoded "Gemini" label.
  const [localProviders, setLocalProviders] = useState<ProviderRecord[]>([]);
  const [cloudProviders, setCloudProviders] = useState<ProviderRecord[]>([]);
  const [selectedLocalProviderId, setSelectedLocalProviderId] = useState<string>('');

  const loadOrchestrationData = async () => {
    try {
      const [data, effective, registry] = await Promise.all([api.orchestration(), api.effectiveSettings(), api.providers()]);
      setModelConfig(data.settings);
      setActiveProviderId(effective.activeProvider);

      const locals = registry.filter(isLocalProvider);
      const clouds = registry.filter((p) => p.tags?.includes('cloud'));
      setLocalProviders(locals);
      setCloudProviders(clouds);
      const matchedLocal = locals.find((p) => p.base_url === data.settings.localEndpoint) || locals[0] || null;
      setSelectedLocalProviderId(matchedLocal?.id || '');

      const discovered = await Promise.all([
        matchedLocal ? api.pingLocalEndpoint(matchedLocal.base_url).then((res) => res.models).catch(() => []) : Promise.resolve([]),
        discoverModelsFor(locals),
      ]);
      const models = mergeModels(...discovered);
      if (models.length > 0) {
        setDiscoveredModels(models);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load orchestration data');
    }
  };

  useEffect(() => {
    loadOrchestrationData();
  }, []);

  const handleUpdateConfig = async (newConfig: ModelConfig) => {
    setModelConfig(newConfig);
    try {
      const updated = await api.updateOrchestration(newConfig);
      setModelConfig(updated);
      toast.success('Orchestration settings saved');
      onProvidersChanged?.();
    } catch (err: any) {
      setError(`Failed to save settings: ${err.message}`);
    }
  };

  // Pins routing to one specific cloud provider (routeTurn()'s 'provider:<id>'
  // pin — see lib/orchestrator.mjs) when more than one cloud provider is
  // configured and ambiguous priority-only selection isn't precise enough.
  // An empty id falls back to plain 'cloud_only' (highest-priority cloud provider).
  const handlePinCloudProvider = (id: string) => handleUpdateConfig({ ...modelConfig, mode: id ? `provider:${id}` : 'cloud_only' });

  const handleSelectLocalProvider = (id: string) => {
    setSelectedLocalProviderId(id);
    const provider = localProviders.find((p) => p.id === id);
    if (provider) void handleUpdateConfig({ ...modelConfig, localEndpoint: provider.base_url });
  };

  const handleSelectModel = async (modelName: string) => {
    // Targets whichever local provider is selected in the endpoint config
    // above, falling back to the overall active provider if none is picked
    // yet — the same provider id Settings' Active Model dropdown writes to,
    // so both surfaces always agree on one result.
    const targetProviderId = selectedLocalProviderId || activeProviderId;
    if (!targetProviderId) {
      setError('No active provider — add or enable a provider in Providers first.');
      return;
    }
    const nextConfig = { ...modelConfig, selectedLocalModel: modelName };
    setModelConfig(nextConfig);
    try {
      await api.setModel(targetProviderId, modelName);
      await api.updateOrchestration(nextConfig);
      toast.success(`Active model set to ${modelName}`);
      onProvidersChanged?.();
    } catch (err: any) {
      setError(`Failed to set active model: ${err.message}`);
    }
  };

  const handleTestEndpoint = async () => {
    const provider = localProviders.find((p) => p.id === selectedLocalProviderId);
    if (!provider) {
      setError('Select a local provider below first.');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.pingLocalEndpoint(provider.base_url);
      const providerModels = await discoverModelsFor(localProviders);
      const models = mergeModels(result.models || [], providerModels);
      if (models.length > 0) {
        setDiscoveredModels(models);
      }
      setTestResult(`Success! ${provider.name} reachable at ${result.endpoint} (${result.latencyMs}ms latency). Discovered ${models.length} model weights.`);
      await handleUpdateConfig({
        ...modelConfig,
        localEndpoint: provider.base_url
      });
    } catch (err: any) {
      setTestResult(`Endpoint ping failed for ${provider.name} at ${provider.base_url}: ${err.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  const defaultModelsList = [
    { name: 'Llama-3.2-3B-Instruct', size: '2.0 GB', vram: '3.2 GB', speed: '42.5 t/s', recommended: true },
    { name: 'Llama-3.2-1B-Instruct', size: '0.8 GB', vram: '1.5 GB', speed: '78.0 t/s', recommended: false },
    { name: 'Qwen-2.5-7B-Instruct', size: '4.5 GB', vram: '6.8 GB', speed: '28.0 t/s', recommended: false },
    { name: 'Phi-3.5-mini-instruct', size: '2.3 GB', vram: '3.5 GB', speed: '38.2 t/s', recommended: false }
  ];

  // A pin ('provider:<id>') only counts as "cloud mode" if it actually
  // points at a cloud-tagged provider — a local pin shouldn't light up this card.
  const pinnedCloudProviderId = typeof modelConfig.mode === 'string' && modelConfig.mode.startsWith('provider:')
    ? modelConfig.mode.slice('provider:'.length)
    : '';
  const isCloudModeActive = modelConfig.mode === 'cloud_only' || cloudProviders.some((p) => p.id === pinnedCloudProviderId);

  return (
    <div className="panel-surface panel-content">
      {/* View Header */}
      <PanelHeader
        icon={<Cpu className="w-5 h-5 text-cyan-400" />}
        title="Model Orchestration & Execution Policy"
        subtitle="Hardware-Aware Local Model Orchestrator"
      />

      {error && (
        <PanelCard padding="compact" className="text-danger bg-danger-subtle border border-rose">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono">{error}</span>
            <button onClick={() => setError(null)} className="btn-icon btn-sm btn-rose">
              <X className="w-4 h-4" />
            </button>
          </div>
        </PanelCard>
      )}



      {/* Orchestration Mode Selection Cards */}
      <PanelCard gap="none">
        <SectionDivider
          title="Select Execution Policy Mode"
          icon={<Sliders className="w-4 h-4 text-cyan-400" />}
        />

        <div className="panel-grid three">
          {/* AUTO Card */}
          <div
            onClick={() => handleUpdateConfig({ ...modelConfig, mode: 'auto' })}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${
              modelConfig.mode === 'auto'
                ? 'border-emerald-400 shadow-xl'
                : 'border-slate-800 hover:border-slate-700'
            }`}
            style={
              modelConfig.mode === 'auto'
                ? { backgroundColor: '#0a1825' }
                : { backgroundColor: '#06111a' }
            }
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-emerald-400 bg-success-subtle px-3 py-1 rounded border border-emerald">
                RECOMMENDED
              </span>
              {modelConfig.mode === 'auto' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            </div>
            <h4 className="text-sm font-bold text-slate-100">Auto-Orchestration</h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Runs standard tasks locally via Ollama / llama.cpp. Automatically escalates complex coding or web search prompts to Gemini Cloud reasoning when configured.
            </p>
          </div>

          {/* LOCAL ONLY Card */}
          <div
            onClick={() => handleUpdateConfig({ ...modelConfig, mode: 'local_only' })}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${
              modelConfig.mode === 'local_only'
                ? 'border-cyan-400 shadow-xl'
                : 'border-slate-800 hover:border-slate-700'
            }`}
            style={
              modelConfig.mode === 'local_only'
                ? { backgroundColor: '#0a1825' }
                : { backgroundColor: '#06111a' }
            }
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-cyan-400 bg-info-subtle px-3 py-1 rounded border border-cyan">
                MAX PRIVACY
              </span>
              {modelConfig.mode === 'local_only' && <CheckCircle2 className="w-4 h-4 text-cyan-400" />}
            </div>
            <h4 className="text-sm font-bold text-slate-100">100% Local Only</h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Strictly keeps all data on your local hardware. No cloud network calls are permitted under any circumstance.
            </p>
          </div>

          {/* CLOUD ONLY Card — reflects whatever cloud provider(s) are actually
              configured in Providers, instead of a hardcoded "Gemini". */}
          <div
            onClick={() => { if (cloudProviders.length <= 1) void handleUpdateConfig({ ...modelConfig, mode: 'cloud_only' }); }}
            className={`p-4 rounded-xl border transition-all ${cloudProviders.length ? 'cursor-pointer' : ''} ${
              isCloudModeActive
                ? 'border-purple-400 shadow-xl'
                : 'border-slate-800 hover:border-slate-700'
            }`}
            style={
              isCloudModeActive
                ? { backgroundColor: '#0a1825' }
                : { backgroundColor: '#06111a' }
            }
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-purple-400 bg-purple-subtle px-3 py-1 rounded border border-purple">
                MAX POWER
              </span>
              {isCloudModeActive && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
            </div>
            <h4 className="text-sm font-bold text-slate-100">
              {cloudProviders.length === 0 ? 'Cloud Provider — Not Configured'
                : cloudProviders.length === 1 ? `Cloud ${cloudProviders[0].name} Only`
                : 'Cloud Provider Only'}
            </h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {cloudProviders.length === 0
                ? 'No cloud provider is configured yet. Add one to unlock maximum reasoning power for complex queries.'
                : 'Directly routes all queries to your configured cloud provider for maximum intelligence, speed, and reasoning (requires cloud approval).'}
            </p>
            {cloudProviders.length === 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenProviders?.(); }}
                className="text-caption text-accent mt-2"
                style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0 }}
              >
                Add a cloud provider in Providers →
              </button>
            )}
            {cloudProviders.length > 1 && (
              <select
                value={pinnedCloudProviderId}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => { e.stopPropagation(); void handlePinCloudProvider(e.target.value); }}
                className="form-input w-full mt-2"
              >
                <option value="">Use highest-priority cloud provider</option>
                {cloudProviders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
          </div>
        </div>
      </PanelCard>

      {/* Local Model Runner Endpoint Config */}
      <PanelCard gap="none">
        <SectionDivider
          title="Local LLM Server Endpoint Configuration"
          icon={<Server className="w-4 h-4 text-cyan-400" />}
        />

        <div className="panel-grid three items-end">
          <div className="span-2 space-y-2">
            <label className="form-label">Local Ollama / llama.cpp Endpoint</label>
            {localProviders.length ? (
              <select
                value={selectedLocalProviderId}
                onChange={(e) => handleSelectLocalProvider(e.target.value)}
                className="form-input w-full"
              >
                {localProviders.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.base_url}</option>)}
              </select>
            ) : (
              <div className="text-caption text-tertiary">
                No local provider is configured yet.{' '}
                <button
                  type="button"
                  onClick={onOpenProviders}
                  className="text-accent"
                  style={{ textDecoration: 'underline', background: 'none', border: 0, padding: 0 }}
                >
                  Add one in Providers →
                </button>
              </div>
            )}
          </div>
          <button
            onClick={handleTestEndpoint}
            disabled={isTesting || !localProviders.length}
            className="btn btn-primary btn-sm"
          >
            {isTesting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Pinging Endpoint...</span>
              </>
            ) : (
              <>
                <Globe className="w-3.5 h-3.5" />
                <span>Ping Endpoint & Save</span>
              </>
            )}
          </button>
        </div>

        {testResult && (
          <div className="p-4 rounded-xl bg-info-subtle border border-cyan text-cyan-300 text-xs font-mono">
            {testResult}
          </div>
        )}

        {/* Local Model Weights Matrix */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="form-label">Select Active Local Model Weights</label>
            {discoveredModels.length > 0 && (
              <span className="text-xs font-mono text-cyan-400 bg-info-subtle px-3 py-1 rounded-xl border border-cyan-500 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> {discoveredModels.length} Real Local Models Detected
              </span>
            )}
          </div>

          <div className="panel-grid two font-mono">
            {(discoveredModels.length > 0
              ? discoveredModels.map((name) => ({ name, size: 'Discovered Weight', vram: 'Dynamic', speed: 'Active', recommended: false }))
              : defaultModelsList
            ).map((m, idx) => {
              const isSelected = modelConfig.selectedLocalModel === m.name;
              return (
                <div
                  key={idx}
                  onClick={() => handleSelectModel(m.name)}
                  style={
                    isSelected
                      ? { backgroundColor: '#0a1825', borderColor: '#53d4ff', color: '#edf6ff' }
                      : { backgroundColor: '#06111a', borderColor: '#213342', color: '#9db2c3' }
                  }
                  className="p-4 rounded-xl border cursor-pointer transition-all flex items-center justify-between hover:border-cyan-400"
                >
                  <div>
                    <div className="text-sm font-bold flex items-center gap-2">
                      <span>{m.name}</span>
                      {m.recommended && (
                        <span className="text-xs bg-success-subtle text-emerald-400 px-2 py-1 rounded border border-emerald">
                          Rec
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Weights: {m.size} | VRAM: {m.vram}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-bold text-cyan-400">{m.speed}</div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-cyan-400" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </PanelCard>

      {/* Auto-Escalation Threshold Rules */}
      <PanelCard gap="none">
        <SectionDivider
          title="Cloud Escalation Threshold Rules"
          icon={<Sparkles className="w-4 h-4 text-purple-400" />}
        />

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono text-slate-300">
              <span>Max Prompt Character Threshold</span>
              <span className="text-purple-400 font-bold">{modelConfig.autoEscalateRules.maxCharCount} Chars</span>
            </div>
            <input
              type="range"
              min="100"
              max="2000"
              step="50"
              value={modelConfig.autoEscalateRules.maxCharCount}
              onChange={(e) =>
                handleUpdateConfig({
                  ...modelConfig,
                  autoEscalateRules: {
                    ...modelConfig.autoEscalateRules,
                    maxCharCount: Number(e.target.value)
                  }
                })
              }
              className="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          <div className="panel-grid two">
            <label className="flex items-center gap-3 p-3 rounded-xl bg-deep border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={modelConfig.autoEscalateRules.requireSearch}
                onChange={(e) =>
                  handleUpdateConfig({
                    ...modelConfig,
                    autoEscalateRules: {
                      ...modelConfig.autoEscalateRules,
                      requireSearch: e.target.checked
                    }
                  })
                }
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-300">
                Auto-Escalate queries requesting live web searches
              </span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl bg-deep border border-slate-800 cursor-pointer hover:border-slate-700 transition-colors">
              <input
                type="checkbox"
                checked={modelConfig.autoEscalateRules.requireCodeExecution}
                onChange={(e) =>
                  handleUpdateConfig({
                    ...modelConfig,
                    autoEscalateRules: {
                      ...modelConfig.autoEscalateRules,
                      requireCodeExecution: e.target.checked
                    }
                  })
                }
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
              <span className="text-xs font-mono text-slate-300">
                Auto-Escalate complex coding or software architecture tasks
              </span>
            </label>
          </div>
        </div>
      </PanelCard>

      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}
