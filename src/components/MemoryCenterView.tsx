import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { MemoryItem } from '../types';
import {
  Brain,
  Search,
  Plus,
  Trash2,
  Edit2,
  Sparkles,
  RefreshCw,
  Tag,
  ShieldCheck,
  Zap,
  CheckCircle2,
  X,
  BookOpen,
  User,
  Cpu,
  Code
} from 'lucide-react';

export function MemoryCenterView() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<MemoryItem | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [valueInput, setValueInput] = useState('');
  const [categoryInput, setCategoryInput] = useState<MemoryItem['category']>('user_preference');
  const [importanceInput, setImportanceInput] = useState<MemoryItem['importance']>('medium');
  const [error, setError] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState<string | null>(null);

  const loadMemories = async () => {
    try {
      const data = searchQuery.trim()
        ? await api.searchMemories(searchQuery, activeCategory)
        : await api.memories(activeCategory);
      setMemories(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load memories');
    }
  };

  useEffect(() => {
    loadMemories();
  }, [activeCategory, searchQuery]);

  const handleOpenAddModal = () => {
    setEditingItem(null);
    setKeyInput('');
    setValueInput('');
    setCategoryInput('user_preference');
    setImportanceInput('medium');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: MemoryItem) => {
    setEditingItem(item);
    setKeyInput(item.key);
    setValueInput(item.value);
    setCategoryInput(item.category);
    setImportanceInput(item.importance);
    setIsModalOpen(true);
  };

  const handleSaveMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || !valueInput.trim()) return;

    try {
      if (editingItem) {
        await api.updateMemory(editingItem.id, {
          key: keyInput.trim(),
          value: valueInput.trim(),
          category: categoryInput,
          importance: importanceInput
        });
        setSavedSuccess('Memory updated successfully');
      } else {
        await api.addMemory({
          key: keyInput.trim(),
          value: valueInput.trim(),
          category: categoryInput,
          importance: importanceInput
        });
        setSavedSuccess('New memory entry stored');
      }
      setIsModalOpen(false);
      await loadMemories();
      setTimeout(() => setSavedSuccess(null), 2500);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await api.deleteMemory(id);
      await loadMemories();
      setSavedSuccess('Memory entry removed');
      setTimeout(() => setSavedSuccess(null), 2500);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAutoSummarize = async () => {
    setIsSummarizing(true);
    try {
      const res = await api.autoSummarizeMemory();
      await loadMemories();
      setSavedSuccess(`Auto-summarization complete: Extracted ${res.addedCount} long-term facts.`);
      setTimeout(() => setSavedSuccess(null), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSummarizing(false);
    }
  };

  const categoryIcons: Record<string, React.ReactNode> = {
    user_preference: <User className="w-3.5 h-3.5 text-cyan-400" />,
    system_fact: <Cpu className="w-3.5 h-3.5 text-emerald-400" />,
    conversation_summary: <BookOpen className="w-3.5 h-3.5 text-purple-400" />,
    code_context: <Code className="w-3.5 h-3.5 text-amber-400" />
  };

  const highImportanceCount = memories.filter((m) => m.importance === 'high').length;

  return (
    <div className="p-4 sm:p-8 bg-[#0a0a0b] text-slate-100 max-w-6xl mx-auto space-y-8 font-sans min-h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider mb-1">
            <Brain className="w-4 h-4" /> Long-Term Memory & Context Engine
          </div>
          <h2 className="text-2xl sm:text-3xl font-light font-mono text-slate-100">
            Memory Center
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {savedSuccess && (
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-3 py-1.5 rounded-xl border border-emerald-800 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {savedSuccess}
            </span>
          )}
          <button
            onClick={handleAutoSummarize}
            disabled={isSummarizing}
            style={{ backgroundColor: '#2a1548', color: '#d8b4fe', borderColor: '#581c87' }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs transition-colors shadow-md"
          >
            <Sparkles className={`w-3.5 h-3.5 text-purple-400 ${isSummarizing ? 'animate-spin' : ''}`} />
            <span>Auto-Summarize Conversations</span>
          </button>
          <button
            onClick={handleOpenAddModal}
            style={{ backgroundColor: '#52d4fb', color: '#041019', fontWeight: 'bold' }}
            className="flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xs transition-all shadow-lg shadow-cyan-500/20"
          >
            <Plus className="w-4 h-4" /> Add Memory
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs font-mono flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Telemetry Stats Grid */}
      <div className="grid grid-cols-4 font-mono">
        <div className="stat-box">
          <div className="title">
            <span>TOTAL MEMORIES</span>
            <Brain className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="value">{memories.length} Items</div>
          <div className="sub">Persistent SQLite Store</div>
        </div>

        <div className="stat-box">
          <div className="title">
            <span>HIGH IMPORTANCE</span>
            <ShieldCheck className="w-4 h-4 text-rose-400" />
          </div>
          <div className="value" style={{ color: '#fca5a5' }}>{highImportanceCount} Items</div>
          <div className="sub">Injected into turn context</div>
        </div>

        <div className="stat-box">
          <div className="title">
            <span>USER PREFERENCES</span>
            <User className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="value">
            {memories.filter((m) => m.category === 'user_preference').length} Items
          </div>
          <div className="sub">Personalization rules</div>
        </div>

        <div className="stat-box">
          <div className="title">
            <span>CONVERSATION FACTS</span>
            <BookOpen className="w-4 h-4 text-purple-400" />
          </div>
          <div className="value">
            {memories.filter((m) => m.category === 'conversation_summary').length} Items
          </div>
          <div className="sub">Extracted from dialogue</div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          {/* Category Tabs */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-2xl border border-slate-800 overflow-x-auto font-mono text-xs">
            {[
              { id: 'all', label: 'All Memories' },
              { id: 'user_preference', label: 'User Preferences' },
              { id: 'system_fact', label: 'System Facts' },
              { id: 'conversation_summary', label: 'Conversation Facts' },
              { id: 'code_context', label: 'Code Context' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveCategory(tab.id)}
                style={
                  activeCategory === tab.id
                    ? { backgroundColor: '#52d4fb', color: '#041019', fontWeight: 'bold', border: 'none' }
                    : { backgroundColor: '#0c1b29', color: '#9db2c3', border: '1px solid #213342' }
                }
                className="px-3 py-1.5 rounded-xl transition-all whitespace-nowrap"
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keys or values..."
              style={{ backgroundColor: '#06111a', color: '#edf6ff', borderColor: '#213342' }}
              className="w-full border rounded-xl pl-9 pr-4 py-2 text-xs font-mono focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Memory Cards Grid */}
      <div className="grid grid-cols-2 gap-4">
        {memories.map((m) => (
          <div key={m.id} className="panel-card">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span style={{ backgroundColor: '#06111a', borderColor: '#213342' }} className="p-1.5 rounded-lg border">
                    {categoryIcons[m.category] || <Tag className="w-3.5 h-3.5 text-slate-400" />}
                  </span>
                  <h4 className="text-sm font-mono font-bold text-slate-100">{m.key}</h4>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${
                      m.importance === 'high'
                        ? 'bg-rose-950 text-rose-300 border-rose-800'
                        : m.importance === 'medium'
                        ? 'bg-amber-950 text-amber-300 border-amber-800'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {m.importance}
                  </span>
                </div>
              </div>

              <p style={{ backgroundColor: '#06111a', borderColor: '#1f3442' }} className="text-xs text-slate-300 leading-relaxed font-mono p-3 rounded-xl border whitespace-pre-wrap">
                {m.value}
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800/60 pt-3 text-[11px] font-mono text-slate-500">
              <span>Category: {m.category}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenEditModal(m)}
                  style={{ backgroundColor: '#06111a', color: '#53d4ff', border: '1px solid #213342' }}
                  className="p-1.5 rounded-lg transition-colors"
                  title="Edit Memory"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDeleteMemory(m.id)}
                  style={{ backgroundColor: '#06111a', color: '#f43f5e', border: '1px solid #213342' }}
                  className="p-1.5 rounded-lg transition-colors"
                  title="Delete Memory"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {!memories.length && (
          <div className="col-span-full bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center font-mono space-y-2">
            <Brain className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">No memory items match the filter or query.</p>
          </div>
        )}
      </div>

      {/* Modal Form for Add/Edit Memory */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-lg w-full space-y-6 shadow-2xl font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Brain className="w-5 h-5 text-cyan-400" />
                {editingItem ? 'Edit Long-Term Memory' : 'Store New Long-Term Memory'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMemory} className="space-y-4 text-xs">
              <div className="space-y-1.5">
                <label className="text-slate-400">Memory Key / Title</label>
                <input
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="e.g. Preferred Coding Style"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-400">Memory Value / Fact Details</label>
                <textarea
                  value={valueInput}
                  onChange={(e) => setValueInput(e.target.value)}
                  placeholder="e.g. Always write clean TypeScript code with explicit types."
                  rows={4}
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-slate-400">Category</label>
                  <select
                    value={categoryInput}
                    onChange={(e) => setCategoryInput(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="user_preference">User Preference</option>
                    <option value="system_fact">System Fact</option>
                    <option value="conversation_summary">Conversation Summary</option>
                    <option value="code_context">Code Context</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-400">Importance Level</label>
                  <select
                    value={importanceInput}
                    onChange={(e) => setImportanceInput(e.target.value as any)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="high">High (Inject in turns)</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                >
                  {editingItem ? 'Save Changes' : 'Store Memory'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
