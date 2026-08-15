import React from 'react';
import { Cloud, Settings2 } from 'lucide-react';
import type { Provider } from '../types';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';

export function SettingsPanel({
  providers,
  activeProvider,
  chooseProvider,
  availableModels,
  selectedModel,
  chooseModel,
  cloudApproved,
  setCloudApproved
}: {
  providers: Provider[];
  activeProvider: string;
  chooseProvider: (id: string) => void;
  availableModels: string[];
  selectedModel: string;
  chooseModel: (model: string) => void;
  cloudApproved: boolean;
  setCloudApproved: (val: boolean) => void;
}) {
  return (
    <div className="panel-surface">
      <PanelHeader
        icon={<Settings2 className="w-5 h-5 text-cyan-400" />}
        title="JARVIS Settings & Provider Configuration"
        subtitle="Configure local AI execution providers, model selections, and cloud authorization rules."
      />

      <div className="panel-content gap-4">
        <div className="panel-grid two">
          <PanelCard gap="default">
            <label className="form-label">Active Provider Engine</label>
            <select
              value={activeProvider}
              onChange={(e) => chooseProvider(e.target.value)}
              className="form-input w-full"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id} disabled={!provider.available && provider.id !== 'cloud'}>
                  {provider.label} {provider.available ? '(Online)' : provider.id === 'cloud' ? '(Not Configured)' : '(Unavailable)'}
                </option>
              ))}
            </select>
            <p className="form-helper">
              Select Ollama or llama.cpp for local-first execution, or Cloud for remote APIs.
            </p>
          </PanelCard>

          <PanelCard gap="default">
            <label className="form-label">Active Model Selection</label>
            <select
              value={selectedModel}
              onChange={(e) => void chooseModel(e.target.value)}
              disabled={!availableModels.length}
              className={`form-input w-full ${!availableModels.length ? 'opacity-50' : ''}`}
            >
              {availableModels.length ? (
                availableModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))
              ) : (
                <option value="">No model reported by active provider</option>
              )}
            </select>
            <p className="form-helper">
              Models detected from your active local provider endpoint.
            </p>
          </PanelCard>
        </div>

        <PanelCard>
          <label className="form-label flex items-center gap-2">
            <Cloud className="w-4 h-4 text-cyan-400" />
            Cloud Request Approval Guardrail
          </label>
          <p className="text-small text-tertiary">
            When cloud provider execution is enabled, JARVIS requires explicit authorization before transmitting prompt data off-device.
          </p>
          <label className="flex items-center gap-2 pt-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={cloudApproved}
              onChange={(e) => setCloudApproved(e.target.checked)}
              className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0"
            />
            I approve sending cloud requests to my configured remote provider endpoint.
          </label>
        </PanelCard>
      </div>
    </div>
  );
}
