import React, { useState, useEffect } from 'react';
import { api } from '../api';
import type { AgentEditorOptions, AgentProfile, AgentRun } from '../types';
import { Users, Bot, Play, Clock, X, Plus, Pencil, Save, Trash2 } from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';

// The name field is display identity only — which CLI/adapter runs an agent is
// already shown by its own badge, so baking "(Claude Code)"/"(Codex)"/etc. into
// the name would be redundant and go stale once CLI becomes an editable selector
// (see lib/agents/registry.mjs, which dropped the same suffix from the defaults).
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

// Mirrors lib/voice-runtime.mjs's localKokoroVoices — used only if GET /api/voice
// is unreachable when this panel loads, same fallback-on-fetch-failure pattern as
// FALLBACK_PROFILES above. The real list always comes from the API when available.
const FALLBACK_VOICES = ['af_bella', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];

const FALLBACK_EDITOR_OPTIONS: AgentEditorOptions = {
  adapters: ['acp', 'process'],
  clis: ['claude', 'codex', 'copilot', 'cline', 'agy'],
  capabilities: ['workspace.read', 'workspace.write', 'git.read', 'shell'],
  maxNameLength: 24,
  maxInstructionsLength: 255
};

// Same visual language as ProvidersView's tag pills — a real "lit up" selected
// state driven by CSS-variable-backed inline styles (this app has no Tailwind
// compiler, so bg-cyan-400/text-white-style classes silently do nothing; see
// src/styles/tokens.css for the variables used here).
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

// Shared editable-fields body used by both the inline "edit an existing agent"
// form and the "add a new agent" form below — same selectors, same validation
// ceilings (options.maxNameLength/maxInstructionsLength), because the backend
// (AgentRegistry) enforces the exact same rules for both create and update.
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
  const [voices, setVoices] = useState<string[]>(FALLBACK_VOICES);
  const [selectedAgent, setSelectedAgent] = useState<string>('architect');
  const [selectedMode, setSelectedMode] = useState<'solo' | 'panel' | 'debate'>('solo');
  const [objective, setObjective] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'profiles' | 'runs'>('profiles');
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

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
    } catch {
      setAgents(FALLBACK_PROFILES);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

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
