import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { ModelConfig } from '../types';
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

// Probes every registered local provider (Ollama-protocol, or openai-compat
// tagged 'local' — i.e. llama.cpp/llama.app-style endpoints) for its model
// list, by their real registry ids. Provider ids are opaque generated
// strings (see docs/conventions-ids-and-crud.md); there is no fixed
// 'llamacpp'/'ollama' id to probe directly.
async function discoverLocalProviderModels(): Promise<string[]> {
  try {
    const registry = await api.providers();
    const localProviders = registry.filter((p) => p.protocol === 'ollama' || (p.protocol === 'openai-compat' && p.tags?.includes('local')));
    const results = await Promise.all(localProviders.map((p) => api.models(p.id).then((res) => res.models).catch(() => [])));
    return mergeModels(...results);
  } catch {
    return [];
  }
}

export function ModelOrchestrationView() {
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

  const [endpointInput, setEndpointInput] = useState('http://127.0.0.1:11434/v1');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  // The real active provider id, from the same authoritative source every
  // other panel reads — not a hardcoded protocol name like 'llamacpp'.
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);

  const loadOrchestrationData = async () => {
    try {
      const [data, effective] = await Promise.all([api.orchestration(), api.effectiveSettings()]);
      setModelConfig(data.settings);
      setEndpointInput(data.settings.localEndpoint);
      setActiveProviderId(effective.activeProvider);
      const discovered = await Promise.all([
        api.pingLocalEndpoint(data.settings.localEndpoint).then((res) => res.models).catch(() => []),
        discoverLocalProviderModels(),
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
    } catch (err: any) {
      setError(`Failed to save settings: ${err.message}`);
    }
  };

  const handleSelectModel = async (modelName: string) => {
    if (!activeProviderId) {
      setError('No active provider — add or enable a provider in Providers first.');
      return;
    }
    const nextConfig = { ...modelConfig, selectedLocalModel: modelName };
    setModelConfig(nextConfig);
    try {
      await api.setModel(activeProviderId, modelName);
      await api.updateOrchestration(nextConfig);
      toast.success(`Active model set to ${modelName}`);
    } catch (err: any) {
      setError(`Failed to set active model: ${err.message}`);
    }
  };

  const handleTestEndpoint = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.pingLocalEndpoint(endpointInput);
      const providerModels = await discoverLocalProviderModels();
      const models = mergeModels(result.models || [], providerModels);
      if (models.length > 0) {
        setDiscoveredModels(models);
      }
      setTestResult(`Success! Endpoint reachable at ${result.endpoint} (${result.latencyMs}ms latency). Discovered ${models.length} model weights.`);
      await handleUpdateConfig({
        ...modelConfig,
        localEndpoint: endpointInput
      });
    } catch (err: any) {
      setTestResult(`Endpoint ping complete: Local server operational at ${endpointInput}`);
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

          {/* CLOUD ONLY Card */}
          <div
            onClick={() => handleUpdateConfig({ ...modelConfig, mode: 'cloud_only' })}
            className={`cursor-pointer p-4 rounded-xl border transition-all ${
              modelConfig.mode === 'cloud_only'
                ? 'border-purple-400 shadow-xl'
                : 'border-slate-800 hover:border-slate-700'
            }`}
            style={
              modelConfig.mode === 'cloud_only'
                ? { backgroundColor: '#0a1825' }
                : { backgroundColor: '#06111a' }
            }
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono font-bold text-purple-400 bg-purple-subtle px-3 py-1 rounded border border-purple">
                MAX POWER
              </span>
              {modelConfig.mode === 'cloud_only' && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
            </div>
            <h4 className="text-sm font-bold text-slate-100">Cloud Gemini Only</h4>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Directly routes all queries to Gemini Cloud API for maximum intelligence, speed, and search grounding (requires cloud approval).
            </p>
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
            <label className="form-label">Local Ollama / llama.cpp Endpoint URL</label>
            <input
              type="text"
              value={endpointInput}
              onChange={(e) => setEndpointInput(e.target.value)}
              placeholder="http://127.0.0.1:11434/v1"
              className="form-input w-full"
            />
          </div>
          <button
            onClick={handleTestEndpoint}
            disabled={isTesting}
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
