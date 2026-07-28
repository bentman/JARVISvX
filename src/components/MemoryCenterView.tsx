import React, { useState } from 'react';
import { MemoryItem, StorageConfig } from '../types';
import {
  Database,
  Cloud,
  HardDrive,
  Plus,
  Trash2,
  Search,
  Download,
  Upload,
  RefreshCw,
  CheckCircle2,
  Key,
  Layers,
  FileText
} from 'lucide-react';

interface MemoryCenterViewProps {
  memories: MemoryItem[];
  onAddMemory: (item: Omit<MemoryItem, 'id' | 'updatedAt'>) => void;
  onDeleteMemory: (id: string) => void;
  onClearMemories: () => void;
  storageConfig: StorageConfig;
  onUpdateStorageConfig: (cfg: StorageConfig) => void;
}

export const MemoryCenterView: React.FC<MemoryCenterViewProps> = ({
  memories,
  onAddMemory,
  onDeleteMemory,
  onClearMemories,
  storageConfig,
  onUpdateStorageConfig
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryItem['category']>('user_pref');
  const [showAddModal, setShowAddModal] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const categories = [
    { id: 'all', label: 'All Items' },
    { id: 'user_pref', label: 'User Preferences' },
    { id: 'fact', label: 'Facts & Context' },
    { id: 'task', label: 'Active Tasks' },
    { id: 'system', label: 'System Directives' }
  ];

  const filteredMemories = memories.filter((m) => {
    const matchesSearch =
      m.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.value.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = selectedCategory === 'all' || m.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim() || !newValue.trim()) return;
    onAddMemory({
      key: newKey.trim(),
      value: newValue.trim(),
      category: newCategory,
      source: 'user_manual'
    });
    setNewKey('');
    setNewValue('');
    setShowAddModal(false);
  };

  const handleExportJson = () => {
    const dataStr = JSON.stringify(memories, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jarvis-memory-vault-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSyncNow = () => {
    setSyncStatus('Syncing remote memory vault...');
    setTimeout(() => {
      onUpdateStorageConfig({
        ...storageConfig,
        lastSyncedAt: new Date().toISOString()
      });
      setSyncStatus('Remote vault synchronized successfully!');
      setTimeout(() => setSyncStatus(null), 3000);
    }, 1000);
  };

  return (
    <div className="p-4 sm:p-8 bg-[#0a0a0b] text-slate-100 max-w-6xl mx-auto space-y-8 font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-subtle pb-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider mb-1">
            <Database className="w-4 h-4" /> Configurable Remote Memory System
          </div>
          <h2 className="text-2xl sm:text-3xl font-light font-mono text-slate-100">
            Memory & Storage Vault
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJson}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 font-mono text-xs transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export JSON</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold transition-all shadow-md shadow-cyan-500/10"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Memory Fact</span>
          </button>
        </div>
      </div>

      {/* Cloud & Remote Storage Provider Config */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div>
            <h3 className="text-base font-mono font-bold text-slate-200 flex items-center gap-2">
              <Cloud className="w-4 h-4 text-cyan-400" /> Storage Provider & Cloud Mirror
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure persistent network file shares, S3 buckets, or encrypted local storage
            </p>
          </div>
          <button
            onClick={handleSyncNow}
            className="px-3 py-1.5 rounded-lg bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono text-xs flex items-center gap-1.5 hover:bg-cyan-900 transition-colors self-start sm:self-auto"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Sync Vault</span>
          </button>
        </div>

        {syncStatus && (
          <div className="p-3 rounded-xl bg-slate-950 border border-cyan-500/30 text-cyan-300 font-mono text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{syncStatus}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono">
          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Storage Provider</label>
            <select
              value={storageConfig.provider}
              onChange={(e) =>
                onUpdateStorageConfig({
                  ...storageConfig,
                  provider: e.target.value as StorageConfig['provider']
                })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value="cloud_sync">Cloud Sync Mirror (Default)</option>
              <option value="aws_s3">AWS S3 Compatible Bucket</option>
              <option value="webdav">WebDAV / Nextcloud Server</option>
              <option value="network_share">Network File Share (SMB/NFS)</option>
              <option value="local_storage">Local Device Vault</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Vault Target / Endpoint</label>
            <input
              type="text"
              value={storageConfig.endpoint}
              onChange={(e) =>
                onUpdateStorageConfig({ ...storageConfig, endpoint: e.target.value })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-slate-400">Folder / Bucket Name</label>
            <input
              type="text"
              value={storageConfig.bucketOrFolder}
              onChange={(e) =>
                onUpdateStorageConfig({ ...storageConfig, bucketOrFolder: e.target.value })
              }
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-2 border-t border-slate-800/60">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={storageConfig.autoSync}
              onChange={(e) =>
                onUpdateStorageConfig({ ...storageConfig, autoSync: e.target.checked })
              }
              className="w-4 h-4 accent-cyan-500 rounded"
            />
            <span>Enable Automatic Background Vault Sync</span>
          </label>
          {storageConfig.lastSyncedAt && (
            <span>Last Synced: {new Date(storageConfig.lastSyncedAt).toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      {/* Memory Inspector & Search */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors whitespace-nowrap ${
                  selectedCategory === c.id
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter memory facts..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Memory Grid Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredMemories.length === 0 ? (
            <div className="col-span-2 text-center py-12 bg-slate-900/40 border border-slate-800 rounded-2xl text-slate-500 font-mono text-sm">
              No memory facts found matching query.
            </div>
          ) : (
            filteredMemories.map((m) => (
              <div
                key={m.id}
                className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-2 shadow-lg relative group hover:border-cyan-500/40 transition-all"
              >
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-cyan-400" />
                    {m.key}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] bg-slate-950 text-slate-400 px-2 py-0.5 rounded border border-slate-800 uppercase">
                      {m.category}
                    </span>
                    <button
                      onClick={() => onDeleteMemory(m.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 transition-colors"
                      title="Delete memory item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <p className="text-sm text-slate-200 font-sans leading-relaxed bg-slate-950 p-2.5 rounded-xl border border-slate-800/80">
                  {m.value}
                </p>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 pt-1">
                  <span>Source: {m.source}</span>
                  <span>Updated: {new Date(m.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Clear Memories Action */}
      <div className="pt-4 border-t border-slate-800 flex justify-end">
        <button
          onClick={onClearMemories}
          className="text-xs font-mono text-rose-400 hover:text-rose-300 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-950 hover:border-rose-800 bg-rose-950/20 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Purge All Memory Records</span>
        </button>
      </div>

      {/* Add Memory Modal Overlay */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl font-mono">
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
              <Plus className="w-4 h-4 text-cyan-400" /> Add Custom Memory Fact
            </h3>
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Key Name</label>
                <input
                  type="text"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="e.g. favorite_code_theme"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Memory Value / Fact</label>
                <textarea
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="e.g. Cyberpunk Neon with dark high-contrast backgrounds"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-cyan-500 h-24"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="user_pref">User Preference</option>
                  <option value="fact">Fact & Context</option>
                  <option value="task">Active Task</option>
                  <option value="system">System Directive</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 text-xs font-mono hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs font-mono hover:bg-cyan-400"
                >
                  Save Fact
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
