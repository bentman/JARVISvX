import React from 'react';
import { ViewMode, PersonaId, PersonaConfig, HardwareProfile, VoiceStatus } from '../types';
import {
  Mic,
  MessageSquare,
  Cpu,
  Database,
  Terminal,
  Zap,
  Code,
  Radio,
  Server,
  Sparkles,
  Volume2
} from 'lucide-react';

interface HeaderProps {
  currentView: ViewMode;
  onSelectView: (view: ViewMode) => void;
  selectedPersona: PersonaConfig;
  personas: Record<string, PersonaConfig>;
  onSelectPersona: (id: PersonaId) => void;
  voiceStatus: VoiceStatus;
  hardware: HardwareProfile;
  modelMode: 'auto' | 'local_only' | 'cloud_only';
  onToggleModelMode: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onSelectView,
  selectedPersona,
  personas,
  onSelectPersona,
  voiceStatus,
  hardware,
  modelMode,
  onToggleModelMode
}) => {
  const views: { id: ViewMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'voice_hud', label: 'Voice HUD', icon: Mic },
    { id: 'chat', label: 'Unified Doorway', icon: MessageSquare },
    { id: 'orchestration', label: 'Model Orchestrator', icon: Cpu },
    { id: 'memory', label: 'Memory Vault', icon: Database },
    { id: 'mcp_skills', label: 'MCP & Skills', icon: Zap },
    { id: 'terminal', label: 'CLI Terminal', icon: Terminal },
    { id: 'self_evolution', label: 'Self-Evolution', icon: Code }
  ];

  return (
    <header className="sticky top-0 z-40 glass border-b border-white/10 px-4 py-3 text-slate-100 flex flex-wrap items-center justify-between gap-4 shadow-2xl backdrop-blur-xl">
      {/* Brand Title & Persona Selector */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shadow-lg border border-cyan-500/30 transition-transform duration-300 hover:scale-105 glow-cyan"
          style={{
            backgroundColor: `${selectedPersona.accentColor}18`,
            color: selectedPersona.accentColor,
            borderColor: `${selectedPersona.accentColor}40`
          }}
        >
          {selectedPersona.avatarSymbol}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-semibold tracking-wider font-mono text-base text-slate-100">
              {selectedPersona.name}
            </h1>
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/50">
              SYSTEM INTELLIGENCE ACTIVE
            </span>
          </div>
          <p className="text-xs text-slate-400 hidden sm:block truncate max-w-xs font-mono">
            {selectedPersona.tagline}
          </p>
        </div>

        {/* Persona Switcher Dropdown */}
        <div className="ml-2 relative group">
          <select
            value={selectedPersona.id}
            onChange={(e) => onSelectPersona(e.target.value as PersonaId)}
            className="bg-slate-900 text-xs text-cyan-300 border border-slate-700/80 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500 cursor-pointer font-mono"
          >
            {(Object.values(personas) as PersonaConfig[]).map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Navigation View Mode Tabs */}
      <nav className="flex items-center gap-1 overflow-x-auto py-1 scrollbar-none">
        {views.map((v) => {
          const Icon = v.icon;
          const isActive = currentView === v.id;
          return (
            <button
              key={v.id}
              onClick={() => onSelectView(v.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 whitespace-nowrap ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-md shadow-cyan-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>{v.label}</span>
            </button>
          );
        })}
      </nav>

      {/* System Status Indicators */}
      <div className="flex items-center gap-3">
        {/* Model Mode Toggle Badge */}
        <button
          onClick={onToggleModelMode}
          title="Click to toggle Model Orchestration Mode (Auto / Local Only / Cloud Only)"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-900 border border-slate-700/80 hover:border-cyan-500/50 transition-colors"
        >
          {modelMode === 'auto' ? (
            <>
              <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="text-emerald-300">AUTO-ORCHESTRATE</span>
            </>
          ) : modelMode === 'local_only' ? (
            <>
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-cyan-300">LOCAL ONLY</span>
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-purple-300">CLOUD GEMINI</span>
            </>
          )}
        </button>

        {/* Voice Status Pill */}
        <div
          className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-xs font-mono border ${
            voiceStatus === 'listening'
              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 animate-pulse'
              : voiceStatus === 'speaking'
              ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50'
              : voiceStatus === 'interrupted'
              ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
              : 'bg-slate-900 text-slate-400 border-slate-800'
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span className="capitalize">{voiceStatus}</span>
        </div>

        {/* Hardware Specs Quick Indicator */}
        <div className="hidden lg:flex items-center gap-2 text-xs font-mono text-slate-400 bg-slate-900 px-2.5 py-1 rounded-lg border border-slate-800">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span>{hardware.cpuCores} Cores</span>
          <span className="text-slate-600">|</span>
          <span>{hardware.ramGB}GB RAM</span>
        </div>
      </div>
    </header>
  );
};
