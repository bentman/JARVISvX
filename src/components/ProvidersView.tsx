import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProviderProtocol, ProviderRecord, ProviderTag, ProviderTestResult } from '../types';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';
import type { BadgeStatus } from './ui/StatusBadge';
import { CheckCircle2, Loader2, Plus, RefreshCw, Server, Trash2, X, Zap } from 'lucide-react';

const ALL_TAGS: ProviderTag[] = ['local', 'cloud', 'fast', 'reasoning', 'vision', 'coding'];

const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  'openai-compat': 'OpenAI-compat',
  'ollama': 'Ollama',
  'azure-openai': 'Azure OpenAI',
  'anthropic': 'Anthropic',
  'gemini': 'Gemini',
};

const PROTOCOL_BADGE: Record<ProviderProtocol, BadgeStatus> = {
  'openai-compat': 'emerald',
  'ollama': 'purple',
  'azure-openai': 'cyan',
  'anthropic': 'amber',
  'gemini': 'danger',
};

const PROTOCOL_HINTS: Record<ProviderProtocol, string> = {
  'openai-compat': 'OpenAI SSE format. Works with llama.cpp, Groq, Together, Anyscale, etc.',
  'ollama':        'No API key needed. Ensure Ollama is running locally.',
  'azure-openai':  'Sends both api-key and Authorization headers for Azure AI Foundry and Azure OpenAI Service.',
  'anthropic':     'Direct Anthropic API. Base URL defaults to https://api.anthropic.com',
  'gemini':        'Google AI REST API. Use your Gemini API key.',
};

const DEFAULT_URLS: Record<ProviderProtocol, string> = {
  'openai-compat': 'http://127.0.0.1:8080/v1',
  'ollama':        'http://127.0.0.1:11434',
  'azure-openai':  'https://<resource>.openai.azure.com/openai/v1',
  'anthropic':     'https://api.anthropic.com',
  'gemini':        'https://generativelanguage.googleapis.com',
};

const DEFAULT_TAGS_FOR: Record<ProviderProtocol, ProviderTag[]> = {
  'openai-compat': ['local', 'fast'],
  'ollama':        ['local'],
  'azure-openai':  ['cloud', 'reasoning'],
  'anthropic':     ['cloud', 'reasoning'],
  'gemini':        ['cloud', 'reasoning'],
};

interface FormState {
  name: string;
  protocol: ProviderProtocol;
  base_url: string;
  model: string;
  api_key: string;
  tags: ProviderTag[];
  priority: number;
}

const emptyForm = (protocol: ProviderProtocol = 'openai-compat'): FormState => ({
  name: '', protocol, base_url: DEFAULT_URLS[protocol], model: '', api_key: '',
  tags: DEFAULT_TAGS_FOR[protocol], priority: 50,
});

function formFromRecord(r: ProviderRecord): FormState {
  return { name: r.name, protocol: r.protocol, base_url: r.base_url, model: r.model, api_key: '', tags: [...r.tags], priority: r.priority };
}

// Probe results constrain model selection to the provider's reported models.
type ProbeState = { status: 'idle' | 'loading' | 'ok' | 'error'; models: string[]; reason?: string };

function ModelField({ form, setForm }: { form: FormState; setForm: React.Dispatch<React.SetStateAction<FormState>> }) {
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle', models: [] });

  useEffect(() => {
    if (!form.base_url.trim()) { setProbe({ status: 'idle', models: [] }); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      setProbe((p) => ({ ...p, status: 'loading' }));
      try {
        const result = await api.probeProviderModels({ protocol: form.protocol, baseUrl: form.base_url, apiKey: form.api_key || undefined });
        if (cancelled) return;
        setProbe(result.available ? { status: 'ok', models: result.models } : { status: 'error', models: [], reason: result.reason });
      } catch (err: any) {
        if (!cancelled) setProbe({ status: 'error', models: [], reason: err.message });
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [form.protocol, form.base_url, form.api_key]);

  const options = form.model && !probe.models.includes(form.model) ? [form.model, ...probe.models] : probe.models;
  const showDropdown = probe.status === 'ok' && options.length > 0;

  return (
    <div className="space-y-2">
      <label className="form-label">Default Model</label>
      {showDropdown ? (
        <select value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} className="form-input w-full">
          <option value="">Select a model…</option>
          {options.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : (
        <input
          value={form.model}
          onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          placeholder={probe.status === 'loading' ? 'Checking server for models…' : 'e.g. llama3.2, gpt-4o, claude-sonnet-4-5'}
          className="form-input w-full"
        />
      )}
      {probe.status === 'loading' && (
        <p className="text-caption text-tertiary" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Loader2 className="w-3 h-3 animate-spin" /> Checking {form.base_url} for available models…
        </p>
      )}
      {probe.status === 'error' && <p className="text-caption text-danger">Error — cannot connect to server ({probe.reason})</p>}
      {probe.status === 'ok' && !probe.models.length && <p className="text-caption text-tertiary">Connected, but the server reported no models — enter one manually.</p>}
    </div>
  );
}

interface ProviderFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit?: boolean;
  apiKeySet?: boolean;
}

function TagPill({ tag, selected, onClick }: { tag: ProviderTag; selected: boolean; onClick: () => void }) {
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
        fontWeight: selected ? 700 : 500,
      }}
    >
      {tag}
    </button>
  );
}

function ProviderForm({ form, setForm, onSave, onCancel, saving, isEdit, apiKeySet }: ProviderFormProps) {
  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: key === 'priority' ? Number(e.target.value) : e.target.value }));

  const handleProtocolChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const p = e.target.value as ProviderProtocol;
    setForm(f => ({ ...f, protocol: p, base_url: isEdit ? f.base_url : DEFAULT_URLS[p], tags: isEdit ? f.tags : DEFAULT_TAGS_FOR[p] }));
  };

  const toggleTag = (tag: ProviderTag) =>
    setForm(f => ({ ...f, tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag] }));

  return (
    <div className="panel-content compact border-t border-slate-800 pt-3">
      <div className="space-y-2">
        <label className="form-label">Name</label>
        <input value={form.name} onChange={set('name')} placeholder="My Provider" className="form-input w-full" />
      </div>
      <div className="space-y-2">
        <label className="form-label">Protocol</label>
        <select value={form.protocol} onChange={handleProtocolChange} className="form-input w-full">
          {Object.entries(PROTOCOL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <p className="text-caption text-tertiary">{PROTOCOL_HINTS[form.protocol]}</p>
      </div>
      <div className="space-y-2">
        <label className="form-label">Base URL</label>
        <input value={form.base_url} onChange={set('base_url')} placeholder={DEFAULT_URLS[form.protocol]} className="form-input w-full font-mono" />
      </div>

      <ModelField form={form} setForm={setForm} />

      <div className="space-y-2">
        <label className="form-label">API Key</label>
        <input type="password" value={form.api_key} onChange={set('api_key')} autoComplete="new-password"
          placeholder={apiKeySet ? '●●●●●● (leave blank to keep existing)' : 'Enter API key (if required)'}
          className="form-input w-full" />
      </div>
      <div className="space-y-2">
        <label className="form-label">Tags</label>
        <div className="flex flex-wrap gap-2">
          {ALL_TAGS.map((tag) => (
            <TagPill key={tag} tag={tag} selected={form.tags.includes(tag)} onClick={() => toggleTag(tag)} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label className="form-label">
          Priority <span className="text-tertiary" style={{ textTransform: 'none' }}>(lower = higher priority)</span>
        </label>
        <div className="flex items-center gap-3">
          <input type="range" min={1} max={100} value={form.priority}
            onChange={(e) => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
            className="flex-1" />
          <span className="text-xs text-secondary font-mono" style={{ width: 28, textAlign: 'right' }}>{form.priority}</span>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving || !form.name.trim() || !form.base_url.trim()} className="btn btn-sm btn-primary flex-1">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Save
        </button>
        <button onClick={onCancel} className="btn btn-sm btn-secondary">Cancel</button>
      </div>
    </div>
  );
}

interface ProviderCardProps {
  record: ProviderRecord;
  isActive: boolean;
  onUpdated: (r: ProviderRecord) => void;
  onDeleted: (id: string) => void;
}

function ProviderCard({ record, isActive, onUpdated, onDeleted }: ProviderCardProps) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState>(formFromRecord(record));
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [testError, setTestError] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleTest = async () => {
    setTestLoading(true); setTestResult(null); setTestError('');
    try { setTestResult(await api.testProvider(record.id)); }
    catch (err: any) { setTestError(err.message); }
    finally { setTestLoading(false); }
  };

  const handleToggle = async () => {
    try { onUpdated(await api.toggleProvider(record.id)); }
    catch (err: any) { setError(err.message); }
  };

  const handleDelete = async () => {
    if (!armDelete) { setArmDelete(true); return; }
    try { await api.deleteProvider(record.id); onDeleted(record.id); }
    catch (err: any) { setError(err.message); setArmDelete(false); }
  };

  const handleSave = async () => {
    setSaving(true); setError('');
    try {
      const payload: any = { name: form.name, protocol: form.protocol, base_url: form.base_url, model: form.model, tags: form.tags, priority: form.priority };
      if (form.api_key) payload.api_key = form.api_key;
      onUpdated(await api.updateProvider(record.id, payload));
      setEditing(false);
    } catch (err: any) { setError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <PanelCard>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <StatusBadge status={PROTOCOL_BADGE[record.protocol] || 'info'}>{PROTOCOL_LABELS[record.protocol]}</StatusBadge>
            {isActive && <span title="This provider will handle the next message"><StatusBadge status="success">Active</StatusBadge></span>}
            <StatusBadge status={record.enabled ? 'online' : 'offline'}>{record.enabled ? 'Enabled' : 'Disabled'}</StatusBadge>
            {testResult && <StatusBadge status={testResult.available ? 'online' : 'offline'}>{testResult.available ? 'Connected' : 'Unavailable'}</StatusBadge>}
          </div>
          <h3 className="text-small font-semibold text-primary truncate">{record.name}</h3>
          <p className="text-caption font-mono text-tertiary truncate mt-1">{record.base_url}</p>
          {record.model && <p className="text-caption text-tertiary mt-1">Model: <span className="text-secondary">{record.model}</span></p>}
          <div className="flex flex-wrap gap-1 mt-2">
            {record.tags.map(tag => (
              <span key={tag} className="text-caption text-tertiary" style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--surface-elevated)', border: '1px solid var(--border-primary)' }}>{tag}</span>
            ))}
            <span className="text-caption text-muted" style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--surface-elevated)', border: '1px solid var(--border-primary)' }}>p{record.priority}</span>
            {record.api_key_set && <span className="text-caption text-muted" style={{ padding: '2px 8px', borderRadius: 6, background: 'var(--surface-elevated)', border: '1px solid var(--border-primary)' }}>Key set</span>}
          </div>
        </div>

        <div className="flex flex-col gap-2 flex-shrink-0" style={{ minWidth: 56 }}>
          <button onClick={() => { setEditing(!editing); setForm(formFromRecord(record)); setError(''); }} className="btn btn-sm btn-secondary">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={handleToggle} className="btn btn-sm btn-secondary" style={record.enabled ? { color: 'var(--emerald-400)' } : undefined}>
            {record.enabled ? 'On' : 'Off'}
          </button>
          <button onClick={handleTest} disabled={testLoading} className="btn btn-sm btn-secondary">
            {testLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          </button>
          <button onClick={handleDelete} onMouseLeave={() => setArmDelete(false)} className={`btn btn-sm ${armDelete ? 'btn-rose' : 'btn-secondary'}`}>
            {armDelete ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {testResult && (
        <p className={`text-caption ${testResult.available ? 'text-success' : 'text-danger'}`}>
          {testResult.available
            ? `✓ ${testResult.latencyMs}ms · ${testResult.models.slice(0, 4).join(', ')}${testResult.models.length > 4 ? ` +${testResult.models.length - 4}` : ''}`
            : `✗ ${testResult.reason}`}
        </p>
      )}
      {testError && <p className="text-caption text-danger">✗ {testError}</p>}
      {error && <p className="text-caption text-danger">{error}</p>}

      {editing && <ProviderForm form={form} setForm={setForm} onSave={handleSave} onCancel={() => setEditing(false)} saving={saving} isEdit apiKeySet={record.api_key_set} />}
    </PanelCard>
  );
}

export function ProvidersView({ onProvidersChanged }: { onProvidersChanged?: () => void } = {}) {
  const [records, setRecords] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');
  // Effective settings, independent of the CRUD list, own active-provider state.
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);

  const refreshActiveProvider = async () => {
    try { setActiveProviderId((await api.effectiveSettings()).activeProvider); }
    catch { /* non-fatal — the CRUD list still loads independently */ }
  };

  const load = async () => {
    setLoading(true);
    try { setRecords(await api.providers()); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
    void refreshActiveProvider();
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    setAddSaving(true); setAddError('');
    try {
      const payload: any = { name: addForm.name, protocol: addForm.protocol, base_url: addForm.base_url, model: addForm.model, tags: addForm.tags, priority: addForm.priority };
      if (addForm.api_key) payload.api_key = addForm.api_key;
      const created = await api.addProvider(payload);
      setRecords(rs => [...rs, created]); setAdding(false); setAddForm(emptyForm());
      void refreshActiveProvider();
      onProvidersChanged?.();
    } catch (err: any) { setAddError(err.message); }
    finally { setAddSaving(false); }
  };

  return (
    <div className="panel-surface panel-content">
      <PanelHeader icon={<Server className="w-5 h-5 text-cyan-400" />} title="Providers" subtitle="Manage LLM provider connections & routing" />

      <div className="flex items-center gap-2">
        <button onClick={() => { setAdding(!adding); setAddForm(emptyForm()); setAddError(''); }} className="btn btn-sm btn-primary">
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {adding ? 'Cancel' : 'Add Provider'}
        </button>
        <button onClick={load} className="btn-icon" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <PanelCard padding="compact" className="text-danger bg-danger-subtle border border-rose">
          <span className="text-xs font-mono">{error}</span>
        </PanelCard>
      )}

      {adding && (
        <PanelCard>
          <SectionDivider title="New Provider" />
          {addError && <p className="text-caption text-danger">{addError}</p>}
          <ProviderForm form={addForm} setForm={setAddForm} onSave={handleAdd} onCancel={() => setAdding(false)} saving={addSaving} />
        </PanelCard>
      )}

      <SectionDivider title="Configured Providers" count={records.length} />

      {loading && (
        <PanelCard hover={false}>
          <p className="text-secondary" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </p>
        </PanelCard>
      )}
      {!loading && records.length === 0 && (
        <PanelCard hover={false}>
          <p className="text-secondary">No providers configured.</p>
          <p className="text-caption text-tertiary">Click &quot;Add Provider&quot; to get started.</p>
        </PanelCard>
      )}

      <div className="space-y-3">
        {records.map(r => (
          <ProviderCard key={r.id} record={r} isActive={r.id === activeProviderId}
            onUpdated={updated => { setRecords(rs => rs.map(p => p.id === updated.id ? updated : p)); void refreshActiveProvider(); onProvidersChanged?.(); }}
            onDeleted={id => { setRecords(rs => rs.filter(p => p.id !== id)); void refreshActiveProvider(); onProvidersChanged?.(); }} />
        ))}
      </div>
    </div>
  );
}
