import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { AgentEditorOptions, AgentProfile, AgentRun } from '../types';
import { Users, Bot, Play, Clock, X, Plus, Pencil, Save, Trash2, MessageSquare, Volume2, VolumeX } from 'lucide-react';
import { useDaemonEvents } from '../events';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';

// Agent names are display identity; runtime CLI and adapter are separate.
const FALLBACK_PROFILES: AgentProfile[] = [
  {
    id: 'architect',
    name: 'Architect',
    description: 'Designs systems and identifies boundaries using Claude Code CLI.',
    adapter: 'acp',
    cli: 'claude',
    command: 'claude',
    voice: 'bm_george',
    capabilities: ['workspace.read', 'git.read'],
    instructions: 'Prefer simple, composable designs. Challenge unnecessary abstractions.',
    isBuiltIn: true
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews implementation for correctness and regressions using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_sarah',
    capabilities: ['workspace.read', 'git.read'],
    instructions: 'Be skeptical. Cite concrete defects and avoid speculative changes.',
    isBuiltIn: true
  },
  {
    id: 'builder',
    name: 'Builder',
    description: 'Implements approved changes with clean code using Claude Code CLI.',
    adapter: 'acp',
    cli: 'claude',
    command: 'claude',
    voice: 'am_michael',
    capabilities: ['workspace.read', 'workspace.write', 'shell'],
    instructions: 'Implement the smallest complete change. Preserve existing conventions.',
    isBuiltIn: true
  },
  {
    id: 'security',
    name: 'Security',
    description: 'Audits code for vulnerabilities using GitHub Copilot CLI.',
    adapter: 'acp',
    cli: 'copilot',
    command: 'copilot',
    voice: 'bm_lewis',
    capabilities: ['workspace.read'],
    instructions: 'Inspect privilege boundaries, input sanitization, data leaks, and strict authentication controls.',
    isBuiltIn: true
  },
  {
    id: 'debugger',
    name: 'Debugger',
    description: 'Diagnoses runtime failures and stack traces using Cline CLI.',
    adapter: 'acp',
    cli: 'cline',
    command: 'cline',
    voice: 'am_adam',
    capabilities: ['workspace.read', 'shell'],
    instructions: 'Analyze stack traces and root causes strictly based on empirical evidence.',
    isBuiltIn: true
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Surveys codebase documentation and APIs using Antigravity CLI.',
    adapter: 'process',
    cli: 'agy',
    command: 'agy',
    voice: 'bf_emma',
    capabilities: ['workspace.read'],
    instructions: 'Gather facts, synthesize documentation, and summarize findings clearly.',
    isBuiltIn: true
  },
  {
    id: 'adversary',
    name: 'Adversary',
    description: 'Presents counter-arguments in multi-agent debate using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_bella',
    capabilities: ['workspace.read'],
    instructions: 'Challenge assumptions. Highlight hidden edge cases and failure modes.',
    isBuiltIn: true
  }
];

// The API owns the voice list; this local set covers an unavailable bootstrap request.

const FALLBACK_EDITOR_OPTIONS: AgentEditorOptions = {
  defaultRosters: {},
  adapters: ['acp', 'process'],
  clis: ['claude', 'codex', 'copilot', 'cline', 'agy'],
  capabilities: ['workspace.read', 'workspace.write', 'git.read', 'shell'],
  maxNameLength: 24,
  maxInstructionsLength: 255
};

// Selected styles use CSS variables because this build has no Tailwind compiler.
function SelectPill({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-caption font-mono transition-all rounded-md"
      style={{
        padding: '4px 10px',
        border: `1px solid ${selected ? 'var(--cyan-400)' : 'var(--border-primary)'}`,
        background: selected ? 'var(--cyan-400)' : 'var(--surface-elevated)',
        color: selected ? 'var(--surface-panel)' : 'var(--text-tertiary)',
        fontWeight: selected ? 700 : 500
      }}
    >
      {label}
    </button>
  );
}

interface AgentFormState {
  name: string;
  description: string;
  adapter: string;
  cli: string;
  voice: string;
  capabilities: string[];
  instructions: string;
}

function profileToForm(agent: AgentProfile): AgentFormState {
  return {
    name: agent.name,
    description: agent.description,
    adapter: agent.adapter,
    cli: agent.cli || '',
    voice: agent.voice,
    capabilities: agent.capabilities,
    instructions: agent.instructions
  };
}


interface AgentDialogTurn {
  id: string;
  agentId: string;
  name: string;
  voice: string;
  text: string;
  status: 'streaming' | 'complete';
}

const AGENT_COLORS: Record<string, { badge: string; border: string; text: string }> = {
  architect: { badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40', border: 'border-cyan-500/30', text: 'text-cyan-400' },
  reviewer: { badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40', border: 'border-purple-500/30', text: 'text-purple-400' },
  builder: { badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', border: 'border-emerald-500/30', text: 'text-emerald-400' },
  adversary: { badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40', border: 'border-amber-500/30', text: 'text-amber-400' },
  security: { badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40', border: 'border-rose-500/30', text: 'text-rose-400' },
  debugger: { badge: 'bg-orange-500/20 text-orange-300 border-orange-500/40', border: 'border-orange-500/30', text: 'text-orange-400' },
  researcher: { badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40', border: 'border-blue-500/30', text: 'text-blue-400' }
};

// Create and edit forms share backend-provided options and length limits.
function AgentFieldsEditor({
  form,
  setForm,
  options,
  voices,
  showIdentityFields
}: {
  form: AgentFormState;
  setForm: React.Dispatch<React.SetStateAction<AgentFormState>>;
  options: AgentEditorOptions;
  voices: string[];
  showIdentityFields: boolean;
}) {
  const toggleCapability = (cap: string) => {
    setForm((f) => ({
      ...f,
      capabilities: f.capabilities.includes(cap) ? f.capabilities.filter((c) => c !== cap) : [...f.capabilities, cap]
    }));
  };

  return (
    <div className="space-y-3">
      {showIdentityFields && (
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1" style={{ minWidth: '160px' }}>
            <label className="form-label">
              Name <span className="text-slate-500">({form.name.length}/{options.maxNameLength})</span>
            </label>
            <input
              type="text"
              className="form-input text-sm"
              value={form.name}
              maxLength={options.maxNameLength}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. QA Runner"
            />
          </div>
          <div className="flex-1" style={{ minWidth: '160px' }}>
            <label className="form-label">Description</label>
            <input
              type="text"
              className="form-input text-sm"
              value={form.description}
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What this agent does"
            />
          </div>
        </div>
      )}

      <div className="flex gap-3 flex-wrap">
        <div className="flex-1" style={{ minWidth: '120px' }}>
          <label className="form-label">Adapter</label>
          <select
            className="form-input text-xs py-2"
            value={form.adapter}
            onChange={(e) => setForm((f) => ({ ...f, adapter: e.target.value, cli: e.target.value === 'acp' ? f.cli || options.clis[0] || '' : '' }))}
          >
            {options.adapters.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        {form.adapter === 'acp' && (
          <div className="flex-1" style={{ minWidth: '120px' }}>
            <label className="form-label">CLI</label>
            <select className="form-input text-xs py-2" value={form.cli} onChange={(e) => setForm((f) => ({ ...f, cli: e.target.value }))}>
              <option value="">Select a CLI...</option>
              {options.clis.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex-1" style={{ minWidth: '140px' }}>
          <label className="form-label">Voice Persona</label>
          <select className="form-input text-xs py-2" value={form.voice} onChange={(e) => setForm((f) => ({ ...f, voice: e.target.value }))}>
            {voices.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="form-label">Capabilities</label>
        <div className="flex gap-2 flex-wrap">
          {options.capabilities.map((cap) => (
            <SelectPill key={cap} label={cap} selected={form.capabilities.includes(cap)} onClick={() => toggleCapability(cap)} />
          ))}
        </div>
      </div>

      {showIdentityFields && (
        <div>
          <label className="form-label">
            Instructions <span className="text-slate-500">({form.instructions.length}/{options.maxInstructionsLength})</span>
          </label>
          <textarea
            className="form-input text-xs"
            rows={2}
            value={form.instructions}
            maxLength={options.maxInstructionsLength}
            onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
            placeholder="System instructions for this agent"
          />
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  options,
  voices,
  onUpdated,
  onDeleted
}: {
  agent: AgentProfile;
  options: AgentEditorOptions;
  voices: string[];
  onUpdated: (agent: AgentProfile) => void;
  onDeleted: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<AgentFormState>(() => profileToForm(agent));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setForm(profileToForm(agent));
  }, [agent, editing]);

  const startEdit = () => {
    setForm(profileToForm(agent));
    setError(null);
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const patch: Partial<AgentProfile> = agent.isBuiltIn
        ? { adapter: form.adapter, cli: form.adapter === 'acp' ? form.cli : undefined, voice: form.voice, capabilities: form.capabilities }
        : {
            name: form.name,
            description: form.description,
            adapter: form.adapter,
            cli: form.adapter === 'acp' ? form.cli : undefined,
            voice: form.voice,
            capabilities: form.capabilities,
            instructions: form.instructions
          };
      const updated = await api.updateAgent(agent.id, patch);
      onUpdated(updated);
      setEditing(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update agent');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAgent(agent.id);
      onDeleted(agent.id);
    } catch (err: any) {
      setError(err.message || 'Failed to delete agent');
      setDeleting(false);
    }
  };

  return (
    <div className="panel-card p-4 space-y-3">
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
            <Bot className="w-4 h-4 text-cyan-400" />
            {agent.name} <span className="text-xs text-cyan-400 font-normal">@{agent.id}</span>
            {agent.available === false && <span className="text-xs text-tertiary font-normal" title={agent.unavailableReason || ''}> · CLI not installed</span>}
            {!agent.isBuiltIn && (
              <StatusBadge status="purple" className="text-caption">custom</StatusBadge>
            )}
          </h3>
          <p className="text-xs text-slate-400 mt-1">{agent.description}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            className="btn-icon btn-sm btn-secondary"
            onClick={() => (editing ? setEditing(false) : startEdit())}
            title={editing ? 'Cancel edit' : 'Edit agent'}
          >
            {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
          </button>
          {!agent.isBuiltIn && (
            <button className="btn-icon btn-sm btn-rose" onClick={handleDelete} disabled={deleting} title="Delete agent">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {editing ? (
        <div className="pt-3 border-t border-slate-800 space-y-3">
          <AgentFieldsEditor form={form} setForm={setForm} options={options} voices={voices} showIdentityFields={!agent.isBuiltIn} />
          {agent.isBuiltIn && (
            <p className="text-xs text-slate-500 italic">
              "{agent.name}" is a built-in role — name, description, and instructions are fixed. Adapter, CLI, voice, and capabilities can be changed.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button className="btn btn-sm btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs space-y-2 pt-3 border-t border-slate-800">
          <div className="flex gap-2 shrink-0 flex-wrap">
            {agent.cli && (
              <span className="text-xs uppercase font-mono px-3 py-1 rounded bg-info-subtle text-cyan-300 border border-cyan">
                cli: {agent.cli}
              </span>
            )}
            <span className="text-xs uppercase font-mono px-3 py-1 rounded bg-elevated text-slate-300 border border-slate-800">
              {agent.adapter}
            </span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-400">Voice Persona:</span>
            <span className="font-mono text-cyan-300 text-xs">{agent.voice}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-400">Capabilities:</span>
            <span className="font-mono text-slate-300 text-xs">{agent.capabilities.join(', ')}</span>
          </div>
          <p className="text-slate-400 italic text-xs pt-1">"{agent.instructions}"</p>
        </div>
      )}
    </div>
  );
}

function AddAgentForm({
  options,
  voices,
  onCreated,
  onCancel
}: {
  options: AgentEditorOptions;
  voices: string[];
  onCreated: (agent: AgentProfile) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AgentFormState>({
    name: '',
    description: '',
    adapter: 'acp',
    cli: options.clis[0] || '',
    voice: voices[0] || '',
    capabilities: ['workspace.read'],
    instructions: ''
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Agent name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const created = await api.createAgent({
        name: form.name,
        description: form.description,
        adapter: form.adapter,
        cli: form.adapter === 'acp' ? form.cli : undefined,
        voice: form.voice,
        capabilities: form.capabilities,
        instructions: form.instructions
      });
      onCreated(created);
    } catch (err: any) {
      setError(err.message || 'Failed to create agent');
    }
    setSaving(false);
  };

  return (
    <PanelCard padding="compact">
      <SectionDivider title="Add New Agent" icon={<Plus className="w-4 h-4 text-cyan-400" />} />
      <form onSubmit={handleCreate} className="space-y-3">
        {error && <p className="text-xs text-danger">{error}</p>}
        <AgentFieldsEditor form={form} setForm={setForm} options={options} voices={voices} showIdentityFields />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={saving || !form.name.trim()}>
            <Plus className="w-3.5 h-3.5" /> {saving ? 'Adding...' : 'Add Agent'}
          </button>
        </div>
      </form>
    </PanelCard>
  );
}

export function AgentOrchestrationView() {
  const [agents, setAgents] = useState<AgentProfile[]>(FALLBACK_PROFILES);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [editorOptions, setEditorOptions] = useState<AgentEditorOptions>(FALLBACK_EDITOR_OPTIONS);
  const [voices, setVoices] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('architect');
  // Empty means the daemon's roster for the chosen mode; a selection replaces it.
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedMode, setSelectedMode] = useState<'solo' | 'panel' | 'debate'>('solo');
  const [objective, setObjective] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'profiles' | 'dialog' | 'runs'>('profiles');
  const [dialogTurns, setDialogTurns] = useState<AgentDialogTurn[]>([]);
  const [activeSpeaker, setActiveSpeaker] = useState<{ name: string; voice: string; id: string } | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(true);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const selectedProfile = agents.find((agent) => agent.id === selectedAgent);
  const selectedCapabilities = selectedMode === 'solo' ? selectedProfile?.capabilities ?? [] : [];
  // Every agent the chosen mode will run, so a privileged one in a panel or debate
  // is approved the same way a privileged solo run is. With no selection that is
  // the roster the daemon publishes for the mode.
  const defaultRoster = editorOptions.defaultRosters?.[selectedMode] ?? [];
  const runningAgentIds = selectedMode === 'solo'
    ? [selectedAgent]
    : selectedAgentIds.length ? selectedAgentIds : defaultRoster;
  const privilegedAgentIds = runningAgentIds.filter((id) => (agents.find((agent) => agent.id === id)?.capabilities ?? []).some((capability) => capability === 'workspace.write' || capability === 'shell'));
  const needsApproval = privilegedAgentIds.length > 0;

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
      const [fetchedAgents, fetchedRuns, fetchedOptions, voiceStatus] = await Promise.all([
        api.agents(),
        api.agentRuns(),
        api.agentEditorOptions().catch(() => null),
        api.voice().catch(() => null)
      ]);
      if (Array.isArray(fetchedAgents) && fetchedAgents.length > 0) {
        setAgents(fetchedAgents);
      }
      if (Array.isArray(fetchedRuns)) {
        setRuns(fetchedRuns);
      }
      if (fetchedOptions) setEditorOptions(fetchedOptions);
      if (voiceStatus && Array.isArray(voiceStatus.voices) && voiceStatus.voices.length) setVoices(voiceStatus.voices);
      if (voiceStatus && typeof voiceStatus.enabled === 'boolean') setVoiceEnabled(voiceStatus.enabled);
    } catch {
      setAgents(FALLBACK_PROFILES);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);


  useDaemonEvents((event) => {
    if (event.type === 'agent-start') {
      setActiveTab('dialog');
      setActiveSpeaker(event.speaker || { name: event.agentId, voice: 'default', id: event.agentId });
      setDialogTurns((prev) => [
        ...prev,
        {
          id: `${event.runId || 'run'}-${event.agentId}-${Date.now()}`,
          agentId: event.agentId,
          name: event.speaker?.name || event.agentId,
          voice: event.speaker?.voice || 'default',
          text: '',
          status: 'streaming'
        }
      ]);
    } else if (event.type === 'agent-token') {
      setDialogTurns((prev) => {
        if (!prev.length) {
          return [{
            id: `${event.runId || 'run'}-${event.agentId}-${Date.now()}`,
            agentId: event.agentId,
            name: event.speaker?.name || event.agentId,
            voice: event.speaker?.voice || 'default',
            text: event.value,
            status: 'streaming'
          }];
        }
        const last = prev[prev.length - 1];
        if (last.agentId !== event.agentId || last.status === 'complete') {
          return [
            ...prev,
            {
              id: `${event.runId || 'run'}-${event.agentId}-${Date.now()}`,
              agentId: event.agentId,
              name: event.speaker?.name || event.agentId,
              voice: event.speaker?.voice || 'default',
              text: event.value,
              status: 'streaming'
            }
          ];
        }
        return [
          ...prev.slice(0, -1),
          { ...last, text: last.text + event.value }
        ];
      });
    } else if (event.type === 'agent-turn-complete') {
      setDialogTurns((prev) => {
        if (!prev.length) return prev;
        const last = prev[prev.length - 1];
        return [
          ...prev.slice(0, -1),
          { ...last, text: event.text || last.text, status: 'complete' }
        ];
      });
      setActiveSpeaker(null);
    } else if (event.type === 'agent-run-complete') {
      setActiveSpeaker(null);
      void loadData();
    } else if (event.type === 'voice-state' && typeof event.enabled === 'boolean') {
      setVoiceEnabled(event.enabled);
    }
  });

  const handleToggleVoice = async () => {
    const next = !voiceEnabled;
    try {
      await api.setListening(next);
      setVoiceEnabled(next);
    } catch (err: any) {
      setError(err.message || 'Failed to toggle voice audio');
    }
  };

  const handleAgentUpdated = (updated: AgentProfile) => {
    setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const handleAgentDeleted = (id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    if (selectedAgent === id) setSelectedAgent(agents.find((a) => a.id !== id)?.id || '');
  };

  const handleAgentCreated = (created: AgentProfile) => {
    setAgents((prev) => [...prev, created]);
    setShowAddForm(false);
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!objective.trim()) return;
    setLoading(true);
    setActiveTab('dialog');
    setDialogTurns([]);
    // The approval control represents the next accepted run only.
    const wanted = approved ? privilegedAgentIds : [];
    setApproved(false);
    try {
      const approvals = await Promise.all(wanted.map((id) => api.requestApproval('agent.privileged', id).then((grant) => grant.id)));
      await api.executeAgentRun({
        ...(selectedMode === 'solo' ? { agentId: selectedAgent } : selectedAgentIds.length ? { agentIds: selectedAgentIds } : {}),
        objective,
        mode: selectedMode,
        requestedCapabilities: selectedCapabilities,
        approvals
      });
      setObjective('');
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
              className={`btn btn-sm ${activeTab === 'dialog' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('dialog')}
            >
              Agent Dialog ({dialogTurns.length ? dialogTurns.length : 'Live'})
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
                    <option key={a.id} value={a.id} disabled={a.available === false}>{a.name} (@{a.id}){a.available === false ? ' — CLI not installed' : ''}</option>
                  ))}
                </select>
              </>
            )}
          </div>

          {selectedMode !== 'solo' && (
            <div className="flex gap-2 items-center flex-wrap text-xs">
              <label className="form-label mb-0">Participants:</label>
              {agents.map((a) => {
                const picked = selectedAgentIds.includes(a.id);
                return (
                  <label key={a.id} className={`flex items-center gap-1 ${a.available === false ? 'text-slate-600' : picked ? 'text-cyan-300' : 'text-slate-400'}`}>
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={a.available === false}
                      onChange={() => setSelectedAgentIds((ids) => (picked ? ids.filter((id) => id !== a.id) : [...ids, a.id]))}
                      className="accent-cyan-500"
                    />
                    @{a.id}
                  </label>
                );
              })}
              {!selectedAgentIds.length && (
                <span className="text-slate-500">none selected — using {defaultRoster.length ? defaultRoster.map((id) => `@${id}`).join(', ') : 'the daemon default'}</span>
              )}
            </div>
          )}

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
        <>
          <PanelCard gap="none">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <SectionDivider
                title="Agent Profiles"
                subtitle={`(${agents.length})`}
                icon={<Bot className="w-4 h-4 text-cyan-400" />}
              />
              {!showAddForm && (
                <button className="btn btn-sm btn-primary" onClick={() => setShowAddForm(true)}>
                  <Plus className="w-3.5 h-3.5" /> Add Agent
                </button>
              )}
            </div>

            <div className="panel-grid two">
              {agents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  options={editorOptions}
                  voices={voices}
                  onUpdated={handleAgentUpdated}
                  onDeleted={handleAgentDeleted}
                />
              ))}
            </div>
          </PanelCard>

          {showAddForm && (
            <AddAgentForm
              options={editorOptions}
              voices={voices}
              onCreated={handleAgentCreated}
              onCancel={() => setShowAddForm(false)}
            />
          )}
        </>
      )}

      {/* Dialog Tab */}
      {activeTab === 'dialog' && (
        <PanelCard gap="none">
          <div className="flex items-center justify-between gap-2 flex-wrap pb-3 border-b border-[var(--border-primary)]">
            <SectionDivider
              title="Multi-Agent Dialog Stream"
              subtitle={`(${dialogTurns.length} turns)`}
              icon={<MessageSquare className="w-4 h-4 text-cyan-400" />}
            />
            <div className="flex items-center gap-3">
              {activeSpeaker ? (
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/40 text-xs font-mono text-cyan-300">
                  <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  Speaking: <strong className="text-white">{activeSpeaker.name}</strong> ({activeSpeaker.voice})
                </div>
              ) : (
                <span className="text-xs font-mono text-slate-500">Idle / Completed</span>
              )}
              <button
                type="button"
                onClick={handleToggleVoice}
                className={`btn btn-sm flex items-center gap-1.5 ${voiceEnabled ? 'btn-primary' : 'btn-secondary'}`}
                title={voiceEnabled ? 'TTS is audible for multi-agent interactions' : 'TTS is muted'}
              >
                {voiceEnabled ? <Volume2 className="w-3.5 h-3.5 text-cyan-300" /> : <VolumeX className="w-3.5 h-3.5 text-slate-400" />}
                <span className="text-xs font-mono">{voiceEnabled ? 'Audible TTS' : 'TTS Muted'}</span>
              </button>
            </div>
          </div>

          <div className="space-y-4 pt-4">
            {dialogTurns.map((turn) => {
              const colorInfo = AGENT_COLORS[turn.agentId] || { badge: 'bg-slate-800 text-slate-300 border-slate-700', border: 'border-slate-800', text: 'text-slate-200' };
              return (
                <div
                  key={turn.id}
                  className={`panel-card p-4 space-y-2 border transition-all ${colorInfo.border} ${turn.status === 'streaming' ? 'bg-cyan-950/20' : ''}`}
                >
                  <div className="flex justify-between items-center flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${colorInfo.badge}`}>
                        {turn.name} (@{turn.agentId})
                      </span>
                      <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800">
                        🎙️ voice: <strong className="text-slate-200">{turn.voice}</strong>
                      </span>
                    </div>
                    <StatusBadge status={turn.status === 'streaming' ? 'info' : 'success'}>
                      {turn.status === 'streaming' ? 'Speaking...' : 'Turn Complete'}
                    </StatusBadge>
                  </div>

                  <div className="bg-deep p-3.5 rounded-xl text-xs text-slate-200 font-mono whitespace-pre-wrap max-h-80 overflow-y-auto border border-slate-800/80 leading-relaxed">
                    {turn.text || <span className="text-slate-500 italic">Thinking and preparing response...</span>}
                    {turn.status === 'streaming' && <span className="inline-block w-2 h-3.5 ml-1 bg-cyan-400 animate-pulse align-middle" />}
                  </div>
                </div>
              );
            })}

            {!dialogTurns.length && (
              <div className="panel-card p-8 text-center text-slate-500 font-mono text-xs">
                No active multi-agent dialog. Execute a solo, panel, or debate run above to stream live agent interactions with audible TTS.
              </div>
            )}
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
