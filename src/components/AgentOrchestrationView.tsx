import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { AgentProfile, AgentRun } from '../types';
import { Users, Bot, Play, Cpu, Shield, Code, Search, RefreshCw, MessageSquare } from 'lucide-react';

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

  const selectedProfile = agents.find((agent) => agent.id === selectedAgent);
  const selectedCapabilities = selectedMode === 'solo' ? selectedProfile?.capabilities ?? [] : [];
  const needsApproval = selectedCapabilities.some((capability) => capability === 'workspace.write' || capability === 'shell');

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
    } catch {}
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-cyan-400" />
            JARVISvX Agent Runtime
          </h2>
          <p className="text-sm text-slate-400">
            Declarative project roles, ACP/Process runtime adapters, and multi-agent collaboration.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className={`px-3 py-1.5 rounded-md text-xs font-semibold ${activeTab === 'profiles' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
            onClick={() => setActiveTab('profiles')}
          >
            Agent Profiles ({agents.length})
          </button>
          <button
            className={`px-3 py-1.5 rounded-md text-xs font-semibold ${activeTab === 'runs' ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
            onClick={() => setActiveTab('runs')}
          >
            Run History ({runs.length})
          </button>
        </div>
      </div>

      {/* Trigger Multi-Agent Collaboration Run */}
      <form onSubmit={handleRun} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex gap-3 items-center">
          <label className="text-xs text-slate-400 font-semibold">Mode:</label>
          <select
            value={selectedMode}
            onChange={(e: any) => setSelectedMode(e.target.value)}
            className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded-md border border-slate-800"
          >
            <option value="solo">solo (Single Agent)</option>
            <option value="panel">panel (Multi-Agent Synthesis)</option>
            <option value="debate">debate (2-Round Bounded Debate)</option>
          </select>

          {selectedMode === 'solo' && (
            <>
              <label className="text-xs text-slate-400 font-semibold">Agent:</label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="bg-slate-950 text-slate-200 text-xs px-2.5 py-1.5 rounded-md border border-slate-800"
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
            className="flex-1 bg-slate-950 text-slate-100 text-sm px-3 py-2 rounded-lg border border-slate-800"
          />
          <button
            type="submit"
            disabled={loading || !objective.trim() || (needsApproval && !approved)}
            className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-4 py-2 rounded-lg text-sm flex items-center gap-1.5 disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            {loading ? 'Running...' : 'Execute Run'}
          </button>
        </div>
      </form>

      {/* Profiles Tab */}
      {activeTab === 'profiles' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-slate-100 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-cyan-400" />
                    {agent.name} <span className="text-xs font-mono text-cyan-400 font-normal">@{agent.id}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">{agent.description}</p>
                </div>
                <div className="flex gap-1">
                  {agent.cli && (
                    <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                      cli: {agent.cli}
                    </span>
                  )}
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                    {agent.adapter}
                  </span>
                </div>
              </div>

              <div className="text-xs space-y-1 pt-2 border-t border-slate-800/80">
                <div className="flex justify-between text-slate-400">
                  <span>Voice Persona:</span>
                  <span className="font-mono text-cyan-300">{agent.voice}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Capabilities:</span>
                  <span className="font-mono text-slate-300">{agent.capabilities.join(', ')}</span>
                </div>
                <p className="text-slate-400 italic text-[11px] pt-1">
                  "{agent.instructions}"
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Runs Tab */}
      {activeTab === 'runs' && (
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-mono text-cyan-400 font-bold">
                  {run.mode.toUpperCase()} RUN · {run.agent_id}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded font-semibold ${run.status === 'completed' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}`}>
                  {run.status}
                </span>
              </div>

              <p className="text-sm font-semibold text-slate-200">{run.objective}</p>

              {run.result && (
                <div className="bg-slate-950 p-3 rounded-lg text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border border-slate-800">
                  {run.result}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
