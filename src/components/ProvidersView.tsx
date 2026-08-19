import React, { useEffect, useState } from 'react';
import { api } from '../api';
import type { ProviderProtocol, ProviderRecord, ProviderTag, ProviderTestResult } from '../types';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { CheckCircle2, Loader2, Plus, RefreshCw, Server, Trash2, X, Zap } from 'lucide-react';

const ALL_TAGS: ProviderTag[] = ['local', 'cloud', 'fast', 'reasoning', 'vision', 'coding'];

const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
  'openai-compat': 'OpenAI-compat',
  'ollama': 'Ollama',
  'azure-openai': 'Azure OpenAI',
  'anthropic': 'Anthropic',
  'gemini': 'Gemini',
};

const PROTOCOL_COLORS: Record<ProviderProtocol, string> = {
  'openai-compat': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'ollama':        'bg-purple-500/20 text-purple-300 border-purple-500/30',
  'azure-openai':  'bg-blue-500/20 text-blue-300 border-blue-500/30',
  'anthropic':     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'gemini':        'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
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

interface ProviderFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isEdit?: boolean;
  apiKeySet?: boolean;
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
    <div className="space-y-2.5 mt-3 pt-3 border-t border-white/10">
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">Name</label>
        <input value={form.name} onChange={set('name')} placeholder="My Provider"
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30" />
      </div>
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">Protocol</label>
        <select value={form.protocol} onChange={handleProtocolChange}
          className="w-full bg-slate-800 border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-white/30">
          {Object.entries(PROTOCOL_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <p className="text-[10px] text-white/30 mt-1">{PROTOCOL_HINTS[form.protocol]}</p>
      </div>
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">Base URL</label>
        <input value={form.base_url} onChange={set('base_url')} placeholder={DEFAULT_URLS[form.protocol]}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs font-mono text-white placeholder-white/30 focus:outline-none focus:border-white/30" />
      </div>
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">Default Model</label>
        <input value={form.model} onChange={set('model')} placeholder="e.g. llama3.2, gpt-4o, claude-sonnet-4-5"
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30" />
      </div>
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">API Key</label>
        <input type="password" value={form.api_key} onChange={set('api_key')} autoComplete="new-password"
          placeholder={apiKeySet ? '●●●●●● (leave blank to keep existing)' : 'Enter API key (if required)'}
          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30" />
      </div>
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">Tags</label>
        <div className="flex flex-wrap gap-1.5">
          {ALL_TAGS.map(tag => (
            <button key={tag} type="button" onClick={() => toggleTag(tag)}
              className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${form.tags.includes(tag) ? 'bg-white/20 border-white/30 text-white' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}>
              {tag}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-[10px] text-white/40 mb-1 uppercase tracking-wider">
          Priority <span className="text-white/20 normal-case">(lower = higher priority)</span>
        </label>
        <div className="flex items-center gap-2">
          <input type="range" min={1} max={100} value={form.priority}
            onChange={e => setForm(f => ({ ...f, priority: Number(e.target.value) }))}
            className="flex-1 accent-slate-400" />
          <span className="text-xs text-white/60 w-6 text-right">{form.priority}</span>
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} disabled={saving || !form.name.trim() || !form.base_url.trim()}
          className="flex-1 py-1.5 rounded bg-white/15 hover:bg-white/25 text-white text-xs font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 text-white/60 text-xs transition-colors">Cancel</button>
      </div>
    </div>
  );
}

interface ProviderCardProps {
  record: ProviderRecord;
  onUpdated: (r: ProviderRecord) => void;
  onDeleted: (id: string) => void;
}

function ProviderCard({ record, onUpdated, onDeleted }: ProviderCardProps) {
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

  const protocolColor = PROTOCOL_COLORS[record.protocol] || 'bg-slate-500/20 text-slate-300 border-slate-500/30';

  return (
    <PanelCard>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${protocolColor}`}>
              {PROTOCOL_LABELS[record.protocol]}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${record.enabled ? 'bg-emerald-400' : 'bg-slate-500'}`}
              title={record.enabled ? 'Enabled' : 'Disabled'} />
            {testResult && <span className={`w-1.5 h-1.5 rounded-full ${testResult.available ? 'bg-emerald-400' : 'bg-red-400'}`}
              title={testResult.available ? 'Connected' : 'Unavailable'} />}
          </div>
          <h3 className="text-sm font-semibold text-white truncate">{record.name}</h3>
          <p className="text-[11px] font-mono text-white/35 truncate mt-0.5">{record.base_url}</p>
          {record.model && <p className="text-[11px] text-white/45 mt-0.5">Model: <span className="text-white/60">{record.model}</span></p>}
          <div className="flex flex-wrap gap-1 mt-2">
            {record.tags.map(tag => (
              <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-white/10 text-white/50 border border-white/8">{tag}</span>
            ))}
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-white/25 border border-white/5">p{record.priority}</span>
            {record.api_key_set && <span className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-white/25 border border-white/5">🔑</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5 flex-shrink-0 min-w-[52px]">
          <button onClick={() => { setEditing(!editing); setForm(formFromRecord(record)); setError(''); }}
            className="text-[11px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 text-white/70 transition-colors">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={handleToggle}
            className={`text-[11px] px-2 py-1 rounded transition-colors ${record.enabled ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300' : 'bg-white/8 hover:bg-white/15 text-white/40'}`}>
            {record.enabled ? 'On' : 'Off'}
          </button>
          <button onClick={handleTest} disabled={testLoading}
            className="text-[11px] px-2 py-1 rounded bg-white/8 hover:bg-white/15 text-white/60 transition-colors flex items-center justify-center gap-1">
            {testLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
          </button>
          <button onClick={handleDelete} onMouseLeave={() => setArmDelete(false)}
            className={`text-[11px] px-2 py-1 rounded transition-colors flex items-center justify-center ${armDelete ? 'bg-red-500/30 text-red-300 hover:bg-red-500/50' : 'bg-white/5 hover:bg-red-500/15 text-white/25 hover:text-red-300'}`}>
            {armDelete ? '✓' : <Trash2 className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`mt-2 p-2 rounded text-[11px] ${testResult.available ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
          {testResult.available
            ? `✓ ${testResult.latencyMs}ms · ${testResult.models.slice(0, 4).join(', ')}${testResult.models.length > 4 ? ` +${testResult.models.length - 4}` : ''}`
            : `✗ ${testResult.reason}`}
        </div>
      )}
      {testError && <div className="mt-2 p-2 rounded text-[11px] bg-red-500/10 text-red-300">✗ {testError}</div>}
      {error && <div className="mt-2 p-2 rounded text-[11px] bg-red-500/10 text-red-300">{error}</div>}

      {editing && <ProviderForm form={form} setForm={setForm} onSave={handleSave} onCancel={() => setEditing(false)} saving={saving} isEdit apiKeySet={record.api_key_set} />}
    </PanelCard>
  );
}

export function ProvidersView() {
  const [records, setRecords] = useState<ProviderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(emptyForm());
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState('');

  const load = async () => {
    setLoading(true);
    try { setRecords(await api.providers()); }
    catch (err: any) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const handleAdd = async () => {
    setAddSaving(true); setAddError('');
    try {
      const payload: any = { name: addForm.name, protocol: addForm.protocol, base_url: addForm.base_url, model: addForm.model, tags: addForm.tags, priority: addForm.priority };
      if (addForm.api_key) payload.api_key = addForm.api_key;
      const created = await api.addProvider(payload);
      setRecords(rs => [...rs, created]); setAdding(false); setAddForm(emptyForm());
    } catch (err: any) { setAddError(err.message); }
    finally { setAddSaving(false); }
  };

  return (
    <div className="panel-content">
      <PanelHeader icon={<Server />} title="Providers" subtitle="Manage LLM provider connections & routing" />

      <div className="panel-actions">
        <button onClick={() => { setAdding(!adding); setAddForm(emptyForm()); setAddError(''); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors">
          {adding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {adding ? 'Cancel' : 'Add Provider'}
        </button>
        <button onClick={load} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 transition-colors" title="Refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && <div className="mx-4 mb-3 p-2 rounded-lg bg-red-500/10 text-red-300 text-xs">{error}</div>}

      {adding && (
        <div className="mx-4 mb-4">
          <PanelCard>
            <h3 className="text-sm font-semibold text-white mb-0.5">New Provider</h3>
            {addError && <div className="mb-2 p-2 rounded text-xs bg-red-500/10 text-red-300">{addError}</div>}
            <ProviderForm form={addForm} setForm={setAddForm} onSave={handleAdd} onCancel={() => setAdding(false)} saving={addSaving} />
          </PanelCard>
        </div>
      )}

      <SectionDivider title="Configured Providers" count={records.length} />

      {loading && (
        <div className="flex items-center justify-center py-12 text-white/40 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {!loading && records.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-white/30 text-sm gap-2">
          <Server className="w-8 h-8 opacity-30" />
          <span>No providers configured.</span>
          <span className="text-xs text-white/20">Click &quot;Add Provider&quot; to get started.</span>
        </div>
      )}

      <div className="panel-list">
        {records.map(r => (
          <ProviderCard key={r.id} record={r}
            onUpdated={updated => setRecords(rs => rs.map(p => p.id === updated.id ? updated : p))}
            onDeleted={id => setRecords(rs => rs.filter(p => p.id !== id))} />
        ))}
      </div>
    </div>
  );
}
