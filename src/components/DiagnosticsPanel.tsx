import React from 'react';
import { Activity, Shield, Server, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';
import { VoiceDiagnostics } from '../VoiceControls';
import type { Diagnostics } from '../types';

const fmt = (bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

export function DiagnosticsPanel({
  data,
  refresh
}: {
  data: Diagnostics | null;
  refresh: () => void;
}) {
  return (
    <div className="panel-surface">
      <PanelHeader
        icon={<Activity className="w-5 h-5 text-cyan-400" />}
        title="Diagnostics"
        subtitle="Real-time local system and provider telemetry"
        actions={
          <button className="btn btn-sm btn-secondary" onClick={refresh}>
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Telemetry
          </button>
        }
      />

      {!data ? (
        <PanelCard hover={false}>
          <p className="text-secondary">Fetching real local system diagnostics…</p>
          <button className="btn btn-sm btn-secondary" onClick={refresh}>
            Force Retry
          </button>
        </PanelCard>
      ) : (
        <div className="panel-grid two">
          <div className="panel-content">
            <PanelCard padding="compact" gap="none">
              <SectionDivider title="System" />
              <p className="text-small text-secondary">
                {data.system.platform} · {data.system.arch} · {data.system.cpu.length} CPU threads
              </p>
              <p className="text-xs text-tertiary">
                Memory: {fmt(data.system.memory.free)} free / {fmt(data.system.memory.total)} total
              </p>
            </PanelCard>

            <PanelCard padding="compact" gap="none">
              <SectionDivider title="Acceleration & Hardware Probes" />
              {data.acceleration.status === 'available' ? (
                <div className="space-y-2">
                  {data.acceleration.gpus?.map((gpu) => (
                    <div key={gpu.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-secondary font-medium">GPU:</span>
                        <span className="text-tertiary">{gpu.name}</span>
                      </div>
                      <StatusBadge status="emerald" className="text-xs">
                        {gpu.memoryBytes ? fmt(gpu.memoryBytes) : 'Dedicated VRAM unavailable'}
                      </StatusBadge>
                    </div>
                  ))}
                  {data.acceleration.npu && (
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-secondary font-medium">NPU / Neural Engine</span>
                      </div>
                      <span className="text-tertiary">
                        {data.acceleration.npu.name || 'Hardware Neural Processor'}
                        {' · '}
                        <span className={data.acceleration.npu.status === 'available' ? 'text-success' : 'text-warning'}>
                          {data.acceleration.npu.status === 'available' ? 'Active' : data.acceleration.npu.reason}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-small text-tertiary">{data.acceleration.reason}</p>
              )}
            </PanelCard>
          </div>

          <PanelCard padding="compact" gap="none">
            <SectionDivider title="Provider Runtimes" />
            <div className="space-y-2">
              {data.providers.map((provider) => (
                <div key={provider.id} className="flex items-center justify-between">
                  <StatusBadge status={provider.available ? 'online' : 'offline'}>
                    <span className="badge-icon">
                      {provider.available ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                    </span>
                    <span className="font-medium">{provider.label}</span>
                  </StatusBadge>
                  <span className="text-xs text-tertiary">
                    {provider.available ? (provider.models.join(', ') || 'No models reported') : provider.reason}
                  </span>
                </div>
              ))}
            </div>
            <VoiceDiagnostics />
          </PanelCard>
        </div>
      )}
    </div>
  );
}

// Re-export for convenience — keeps import concise in App.tsx
export { fmt };
