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
  X,
  BookOpen,
  User,
  Cpu,
  Code
} from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { Modal } from './ui/Modal';
import { ToastStack } from './ui/ToastStack';
import { useToast } from '../hooks/useToast';

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
  const toast = useToast();

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
        toast.success('Memory updated successfully');
      } else {
        await api.addMemory({
          key: keyInput.trim(),
          value: valueInput.trim(),
          category: categoryInput,
          importance: importanceInput
        });
        toast.success('New memory entry stored');
      }
      setIsModalOpen(false);
      await loadMemories();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await api.deleteMemory(id);
      await loadMemories();
      toast.success('Memory entry removed');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAutoSummarize = async () => {
    setIsSummarizing(true);
    try {
      const res = await api.autoSummarizeMemory();
      await loadMemories();
      toast.success(`Auto-summarization complete: Extracted ${res.addedCount} long-term facts.`, 3000);
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

  const importanceStyle = (importance: string) => {
    switch (importance) {
      case 'high':
        return { backgroundColor: 'rgba(71, 26, 35, 0.8)', borderColor: 'rgba(71, 26, 35, 0.6)', color: '#fca5a5' };
      case 'medium':
        return { backgroundColor: 'rgba(78, 41, 10, 0.8)', borderColor: 'rgba(113, 71, 8, 0.6)', color: '#fcd34d' };
      default:
        return { backgroundColor: 'rgba(6, 17, 26, 0.8)', borderColor: 'rgba(31, 52, 66, 0.6)', color: '#94a3b8' };
    }
  };

  const categoryTabs = [
    { id: 'all', label: 'All Memories' },
    { id: 'user_preference', label: 'User Preferences' },
    { id: 'system_fact', label: 'System Facts' },
    { id: 'conversation_summary', label: 'Conversation Facts' },
    { id: 'code_context', label: 'Code Context' }
  ];

  return (
    <div className="panel-surface panel-content">
      {/* Header */}
      <PanelHeader
        icon={<Brain className="w-5 h-5 text-cyan-400" />}
        title="Memory Center"
        subtitle="Long-Term Memory & Context Engine"
        actions={
          <div className="flex items-center gap-3">
            <button
              onClick={handleAutoSummarize}
              disabled={isSummarizing}
              className="btn btn-sm btn-purple"
            >
              <Sparkles className={`w-3.5 h-3.5 text-purple-400 ${isSummarizing ? 'animate-spin' : ''}`} />
              <span>Auto-Summarize Conversations</span>
            </button>
            <button
              onClick={handleOpenAddModal}
              className="btn btn-sm btn-primary"
            >
              <Plus className="w-4 h-4" /> Add Memory
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

      {/* Telemetry Stats Grid */}
      <div className="panel-grid four font-mono">
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
      <PanelCard gap="none">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          {/* Category Tabs */}
          <div className="flex items-center gap-2 bg-elevated p-2 rounded-xl border border-slate-800 overflow-x-auto font-mono text-xs">
            {categoryTabs.map((tab) => {
              const isActive = activeCategory === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveCategory(tab.id)}
                  className={`px-3 py-2 rounded-xl transition-all whitespace-nowrap text-xs font-mono ${
                    isActive
                      ? 'font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  style={
                    isActive
                      ? { backgroundColor: '#52d4fb', color: '#041019' }
                      : { backgroundColor: '#06111a', border: '1px solid #213342' }
                  }
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search Box */}
          <div className="relative min-w-40">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search keys or values..."
              className="form-input w-full"
              style={{ paddingLeft: '32px' }}
            />
          </div>
        </div>
      </PanelCard>

      {/* Memory Cards Grid */}
      <div className="panel-grid three">
        {memories.map((m) => (
          <PanelCard key={m.id} padding="compact" hover={false}>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="p-1 rounded-lg border border-slate-800 bg-deep">
                    {categoryIcons[m.category] || <Tag className="w-3.5 h-3.5 text-slate-400" />}
                  </span>
                  <h4 className="text-xs font-bold text-slate-100">{m.key}</h4>
                </div>

                <span
                  className="text-xs font-mono uppercase px-3 py-1 rounded"
                  style={importanceStyle(m.importance)}
                >
                  {m.importance}
                </span>
              </div>

              <p className="text-xs text-slate-300 font-mono p-3 rounded-lg bg-deep border border-slate-800 whitespace-pre-wrap">
                {m.value}
              </p>
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs font-mono text-slate-500">
              <span>Category: {m.category}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleOpenEditModal(m)}
                  className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
                  title="Edit Memory"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDeleteMemory(m.id)}
                  className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                  title="Delete Memory"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </PanelCard>
        ))}
        {!memories.length && (
          <div className="col-span-full panel-card p-6 text-center font-mono space-y-2">
            <Brain className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="text-slate-400 text-sm">No memory items match the filter or query.</p>
          </div>
        )}
      </div>

      {/* Modal Form for Add/Edit Memory */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingItem ? 'Edit Long-Term Memory' : 'Store New Long-Term Memory'}
        icon={<Brain className="w-5 h-5 text-cyan-400" />}
        maxWidth="560px"
      >
        <form onSubmit={handleSaveMemory} className="panel-content gap-3">
          <div className="space-y-2">
            <label className="form-label">Memory Key / Title</label>
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="e.g. Preferred Coding Style"
              className="form-input w-full"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="form-label">Memory Value / Fact Details</label>
            <textarea
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              placeholder="e.g. Always write clean TypeScript code with explicit types."
              rows={4}
              className="form-input w-full"
              required
            />
          </div>

          <div className="panel-grid two">
            <div className="space-y-2">
              <label className="form-label">Category</label>
              <select
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value as any)}
                className="form-input w-full"
              >
                <option value="user_preference">User Preference</option>
                <option value="system_fact">System Fact</option>
                <option value="conversation_summary">Conversation Summary</option>
                <option value="code_context">Code Context</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="form-label">Importance Level</label>
              <select
                value={importanceInput}
                onChange={(e) => setImportanceInput(e.target.value as any)}
                className="form-input w-full"
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
              className="btn btn-sm btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-sm btn-primary">
              {editingItem ? 'Save Changes' : 'Store Memory'}
            </button>
          </div>
        </form>
      </Modal>
      <ToastStack toasts={toast.toasts} onDismiss={toast.dismiss} />
    </div>
  );
}
