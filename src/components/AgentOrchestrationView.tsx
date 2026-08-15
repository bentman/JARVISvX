import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { AgentProfile, AgentRun } from '../types';
import { Users, Bot, Play, Cpu, Shield, Code, Search, RefreshCw, MessageSquare, CheckCircle2, AlertCircle, Clock, Pause, X } from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';

const FALLBACK_PROFILES: AgentProfile[] = [
  {
    id: 'architect',
    name: 'Architect (Claude Code)',
    description: 'Designs systems and identifies boundaries using Claude Code CLI.',
    adapter: 'acp',
    cli: 'claude',
    command: 'claude',
    voice: 'bm_george',
    capabilities: ['workspace.read', 'git.read'],
    instructions: 'Prefer simple, composable designs. Challenge unnecessary abstractions.'
  },
  {
    id: 'reviewer',
    name: 'Reviewer (Codex)',
    description: 'Reviews implementation for correctness and regressions using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_sarah',
    capabilities: ['workspace.read', 'git.read'],
    instructions: 'Be skeptical. Cite concrete defects and avoid speculative changes.'
  },
  {
    id: 'builder',
    name: 'Builder (Claude Code)',
    description: 'Implements approved changes with clean code using Claude Code CLI.',
    adapter: 'acp',
    cli: 'claude',
    command: 'claude',
    voice: 'am_michael',
    capabilities: ['workspace.read', 'workspace.write', 'shell'],
    instructions: 'Implement the smallest complete change. Preserve existing conventions.'
  },
  {
    id: 'security',
    name: 'Security (Copilot CLI)',
    description: 'Audits code for vulnerabilities using GitHub Copilot CLI.',
    adapter: 'acp',
    cli: 'copilot',
    command: 'copilot',
    voice: 'bm_lewis',
    capabilities: ['workspace.read'],
    instructions: 'Inspect privilege boundaries, input sanitization, data leaks, and strict authentication controls.'
  },
  {
    id: 'debugger',
    name: 'Debugger (Cline CLI)',
    description: 'Diagnoses runtime failures and stack traces using Cline CLI.',
    adapter: 'acp',
    cli: 'cline',
    command: 'cline',
    voice: 'am_adam',
    capabilities: ['workspace.read', 'shell'],
    instructions: 'Analyze stack traces and root causes strictly based on empirical evidence.'
  },
  {
    id: 'researcher',
    name: 'Researcher (Antigravity)',
    description: 'Surveys codebase documentation and APIs using Antigravity CLI.',
    adapter: 'process',
    cli: 'agy',
    command: 'agy',
    voice: 'bf_emma',
    capabilities: ['workspace.read'],
    instructions: 'Gather facts, synthesize documentation, and summarize findings clearly.'
  },
  {
    id: 'adversary',
    name: 'Adversary (Codex)',
    description: 'Presents counter-arguments in multi-agent debate using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_bella',
    capabilities: ['workspace.read'],
    instructions: 'Challenge assumptions. Highlight hidden edge cases and failure modes.'
  }
];

export function AgentOrchestrationView() {
  const [agents, setAgents] = useState<AgentProfile[]>(FALLBACK_PROFILES);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('architect');
  const [selectedMode, setSelectedMode] = useState<'solo' | 'panel' | 'debate'>('solo');
  const [objective, setObjective] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'profiles' | 'runs'>('profiles');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = agents.find((agent) => agent.id === selectedAgent);
  const selectedCapabilities = selectedMode === 'solo' ? selectedProfile?.capabilities ?? [] : [];
  const needsApproval = selectedCapabilities.some((capability) => capability === 'workspace.write' || capability === 'shell');

  const runBadgeStatus = (status: string) => {
    switch (status) {
      case 'completed': return 'success' as const;
      case 'running': return 'info' as const;
      case 'failed': return 'danger' as const;
      default: return 'pending' as const;
    }
  };

  const loadData = async () => {
    try {
      const [fetchedAgents, fetchedRuns] = await Promise.all([
        api.agents(),
        api.agentRuns()
      ]);
      if (Array.isArray(fetchedAgents) && fetchedAgents.length > 0) {
        setAgents(fetchedAgents);
      }
      if (Array.isArray(fetchedRuns)) {
        setRuns(fetchedRuns);
      }
    } catch {
      setAgents(FALLBACK_PROFILES);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim()) return;
    setLoading(true);
    try {
      await api.executeAgentRun({
        agentId: selectedAgent,
        agentIds: ['architect', 'reviewer', 'adversary'],
        objective,
        mode: selectedMode,
        requestedCapabilities: selectedCapabilities,
        approved: !needsApproval || approved
      });
      setObjective('');
      setApproved(false);
      await loadData();
      setActiveTab('runs');
    } catch (err: any) {
      setError(err.message || 'Failed to execute agent run');
    }
    setLoading(false);
  };

  return (
    <div className="panel-surface panel-content">
      {/* Header */}
      <PanelHeader
        icon={<Users className="w-5 h-5 text-cyan-400" />}
        title="JARVISvX Agent Runtime"
        subtitle="Declarative project roles, ACP/Process runtime adapters, and multi-agent collaboration."
        actions={
          <div className="flex gap-2">
            <button
              className={`btn btn-sm ${activeTab === 'profiles' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('profiles')}
            >
              Agent Profiles ({agents.length})
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'runs' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('runs')}
            >
              Run History ({runs.length})
            </button>
          </div>
        }
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

      {/* Trigger Multi-Agent Collaboration Run */}
      <PanelCard padding="compact">
        <SectionDivider
          title="Execute Multi-Agent Run"
          icon={<Play className="w-4 h-4 text-cyan-400" />}
        />

        <form onSubmit={handleRun} className="panel-content gap-3">
          <div className="flex gap-3 items-center flex-wrap">
            <label className="form-label mb-0">Mode:</label>
            <select
              value={selectedMode}
              onChange={(e: any) => setSelectedMode(e.target.value)}
              className="form-input text-xs py-2"
              style={{ maxWidth: '240px' }}
            >
              <option value="solo">solo (Single Agent)</option>
              <option value="panel">panel (Multi-Agent Synthesis)</option>
              <option value="debate">debate (2-Round Bounded Debate)</option>
            </select>

            {selectedMode === 'solo' && (
              <>
                <label className="form-label mb-0">Agent:</label>
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="form-input text-xs py-2"
                  style={{ maxWidth: '240px' }}
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} (@{a.id})</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {needsApproval && (
            <label className="flex items-center gap-2 text-xs text-amber-300">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
                className="accent-cyan-500"
              />
              Approve privileged agent capabilities for this run.
            </label>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Specify multi-agent task objective or debate question..."
              className="form-input flex-1 text-sm"
            />
            <button
              type="submit"
              disabled={loading || !objective.trim() || (needsApproval && !approved)}
              className="btn btn-primary"
            >
              <Play className="w-4 h-4" />
              {loading ? 'Running...' : 'Execute Run'}
            </button>
          </div>
        </form>
      </PanelCard>

      {/* Profiles Tab */}
      {activeTab === 'profiles' && (
        <PanelCard gap="none">
          <SectionDivider
            title="Agent Profiles"
            subtitle={`(${agents.length})`}
            icon={<Bot className="w-4 h-4 text-cyan-400" />}
          />

          <div className="panel-grid two">
            {agents.map((agent) => (
              <div key={agent.id} className="panel-card p-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <Bot className="w-4 h-4 text-cyan-400" />
                      {agent.name} <span className="text-xs text-cyan-400 font-normal">@{agent.id}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">{agent.description}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {agent.cli && (
                      <span className="text-xs uppercase font-mono px-3 py-1 rounded bg-info-subtle text-cyan-300 border border-cyan">
                        cli: {agent.cli}
                      </span>
                    )}
                    <span className="text-xs uppercase font-mono px-3 py-1 rounded bg-elevated text-slate-300 border border-slate-800">
                      {agent.adapter}
                    </span>
                  </div>
                </div>

                <div className="text-xs space-y-2 pt-3 border-t border-slate-800">
                  <div className="flex justify-between text-slate-400">
                    <span className="text-xs font-medium text-slate-400">Voice Persona:</span>
                    <span className="font-mono text-cyan-300 text-xs">{agent.voice}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span className="text-xs font-medium text-slate-400">Capabilities:</span>
                    <span className="font-mono text-slate-300 text-xs">{agent.capabilities.join(', ')}</span>
                  </div>
                  <p className="text-slate-400 italic text-xs pt-1">
                    "{agent.instructions}"
                  </p>
                </div>
              </div>
            ))}
          </div>
        </PanelCard>
      )}

      {/* Runs Tab */}
      {activeTab === 'runs' && (
        <PanelCard gap="none">
          <SectionDivider
            title="Run History"
            icon={<Clock className="w-4 h-4 text-cyan-400" />}
          />

          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="panel-card p-4 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-mono text-cyan-400 font-bold">
                    {run.mode.toUpperCase()} RUN · {run.agent_id}
                  </span>
                  <StatusBadge status={runBadgeStatus(run.status)}>
                    {run.status}
                  </StatusBadge>
                </div>

                <p className="text-xs font-semibold text-slate-200">{run.objective}</p>

                {run.result && (
                  <div className="bg-deep p-3 rounded-xl text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-slate-800">
                    {run.result}
                  </div>
                )}
              </div>
            ))}
            {!runs.length && (
              <div className="panel-card p-6 text-center text-slate-500 font-mono text-xs">
                No agent runs recorded yet. Execute a run to see results here.
              </div>
            )}
          </div>
        </PanelCard>
      )}
    </div>
  );
}
