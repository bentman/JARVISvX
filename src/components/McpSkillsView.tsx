import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { McpServer, McpTool, SkillModule } from '../types';
import { Modal } from './ui/Modal';
import { StatusBadge } from './ui/StatusBadge';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import {
  Zap,
  Server,
  Code,
  CheckCircle2,
  ToggleLeft,
  ToggleRight,
  Terminal,
  Plus,
  Trash2,
  Play,
  RefreshCw,
  Edit,
  X,
  Search,
  Download,
  ExternalLink
} from 'lucide-react';

export function McpSkillsView() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [skills, setSkills] = useState<SkillModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  // Modals state
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [showAddSkillModal, setShowAddSkillModal] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillModule | null>(null);
  const [toolTester, setToolTester] = useState<{ server: McpServer; tool: McpTool } | null>(null);

  // Form states for server creation
  const [newServerName, setNewServerName] = useState('');
  const [newServerType, setNewServerType] = useState('http');
  const [newServerEndpoint, setNewServerEndpoint] = useState('');

  // Form states for skill creation/edit
  const [skillName, setSkillName] = useState('');
  const [skillCmd, setSkillCmd] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillCode, setSkillCode] = useState('');

  // Test execution state
  const [toolParams, setToolParams] = useState('{}');
  const [toolExecuting, setToolExecuting] = useState(false);
  const [toolResult, setToolResult] = useState<string | null>(null);

  const [testSkillInput, setTestSkillInput] = useState('');
  const [skillTesting, setSkillTesting] = useState(false);
  const [skillTestResult, setSkillTestResult] = useState<string | null>(null);

  // Real skills.sh import — see lib/skills-source.mjs. Takes an "owner/repo" (or a
  // github.com URL), fetches the actual SKILL.md, and adds it as a genuine
  // executable skill; no placeholder/simulated result on success or failure.
  const [importSource, setImportSource] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [mcpData, skillsData] = await Promise.all([
        api.mcpServers().catch(() => ({ servers: [] })),
        api.skills().catch(() => [])
      ]);
      setServers(mcpData.servers || []);
      setSkills(skillsData || []);
      if (!selectedSkillId && skillsData.length > 0) {
        setSelectedSkillId(skillsData[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load MCP & Skills data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handlePingServer = async (id: string) => {
    try {
      const res = await api.pingMcpServer(id);
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: res.status as any, latencyMs: res.latencyMs } : s))
      );
    } catch (err: any) {
      setError(`Failed to ping server: ${err.message}`);
    }
  };

  const handleDeleteServer = async (id: string) => {
    try {
      await api.deleteMcpServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err: any) {
      setError(`Failed to delete server: ${err.message}`);
    }
  };

  const handleAddServerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim() || !newServerEndpoint.trim()) return;
    try {
      const added = await api.addMcpServer({
        name: newServerName.trim(),
        type: newServerType,
        endpoint: newServerEndpoint.trim(),
        tools: [{ name: 'execute', description: 'Default MCP tool endpoint' }]
      });
      setServers((prev) => [...prev, added]);
      setNewServerName('');
      setNewServerEndpoint('');
      setShowAddServerModal(false);
    } catch (err: any) {
      setError(`Failed to add MCP server: ${err.message}`);
    }
  };

  const handleExecuteTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toolTester) return;
    setToolExecuting(true);
    setToolResult(null);
    try {
      let parsedParams = {};
      try {
        parsedParams = JSON.parse(toolParams);
      } catch (e) {
        parsedParams = { input: toolParams };
      }
      const res = await api.executeMcpTool(toolTester.server.id, toolTester.tool.name, parsedParams);
      setToolResult(res.output || JSON.stringify(res, null, 2));
    } catch (err: any) {
      setToolResult(`Error: ${err.message}`);
    } finally {
      setToolExecuting(false);
    }
  };

  const handleToggleSkill = async (id: string) => {
    try {
      const updated = await api.toggleSkill(id);
      setSkills((prev) => prev.map((s) => (s.id === id ? updated : s)));
    } catch (err: any) {
      setError(`Failed to toggle skill: ${err.message}`);
    }
  };

  const handleDeleteSkill = async (id: string) => {
    try {
      await api.deleteSkill(id);
      setSkills((prev) => prev.filter((s) => s.id !== id));
      if (selectedSkillId === id) {
        setSelectedSkillId(skills.find((s) => s.id !== id)?.id || null);
      }
    } catch (err: any) {
      setError(`Failed to delete skill: ${err.message}`);
    }
  };

  const handleSaveSkillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skillName.trim() || !skillCmd.trim() || !skillCode.trim()) return;
    try {
      if (editingSkill) {
        const updated = await api.updateSkill(editingSkill.id, {
          name: skillName.trim(),
          slashCommand: skillCmd.trim(),
          description: skillDesc.trim(),
          code: skillCode
        });
        setSkills((prev) => prev.map((s) => (s.id === editingSkill.id ? updated : s)));
      } else {
        const created = await api.addSkill({
          name: skillName.trim(),
          slashCommand: skillCmd.trim(),
          description: skillDesc.trim(),
          code: skillCode,
          type: 'custom',
          enabled: true,
          author: 'User',
          version: '1.0.0'
        });
        setSkills((prev) => [created, ...prev]);
        setSelectedSkillId(created.id);
      }
      setShowAddSkillModal(false);
      setEditingSkill(null);
      setSkillName('');
      setSkillCmd('');
      setSkillDesc('');
      setSkillCode('');
    } catch (err: any) {
      setError(`Failed to save skill: ${err.message}`);
    }
  };

  const handleTestSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeSkill = skills.find((s) => s.id === selectedSkillId);
    if (!activeSkill) return;
    setSkillTesting(true);
    setSkillTestResult(null);
    try {
      const res = await api.executeSkill(activeSkill.slashCommand, testSkillInput);
      setSkillTestResult(res.output || JSON.stringify(res, null, 2));
    } catch (err: any) {
      setSkillTestResult(`Skill Execution Error: ${err.message}`);
    } finally {
      setSkillTesting(false);
    }
  };

  const openEditSkill = (skill: SkillModule) => {
    setEditingSkill(skill);
    setSkillName(skill.name);
    setSkillCmd(skill.slashCommand);
    setSkillDesc(skill.description);
    setSkillCode(skill.code);
    setShowAddSkillModal(true);
  };

  const handleImportSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importSource.trim()) return;
    setImporting(true);
    setImportError(null);
    try {
      const created = await api.importSkill(importSource.trim());
      setSkills((prev) => [created, ...prev]);
      setSelectedSkillId(created.id);
      setImportSource('');
    } catch (err: any) {
      setImportError(err.message || 'Failed to import skill');
    }
    setImporting(false);
  };

  // Downloads a skill as a real SKILL.md file (see lib/skills-source.mjs's
  // renderSkillAsMarkdown) — a genuine client-side file save, not a no-op button.
  const handleExportSkill = async (id: string) => {
    try {
      const { filename, content } = await api.exportSkill(id);
      const blob = new Blob([content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(`Failed to export skill: ${err.message}`);
    }
  };

  const activeSkill = skills.find((s) => s.id === selectedSkillId) || skills[0];

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.slashCommand.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.description.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="panel-surface panel-content">
      {/* Header */}
      <PanelHeader
        icon={<Zap className="w-5 h-5 text-cyan-400" />}
        title="MCP Servers & Dynamic Slash Skills"
        subtitle="Model Context Protocol & Extensible Runtime Engine"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditingSkill(null);
                setSkillName('');
                setSkillCmd('/custom');
                setSkillDesc('');
                setSkillCode(`async function execute({ input }) {\n  return { success: true, result: \`Executed with input: \${input}\` };\n}`);
                setShowAddSkillModal(true);
              }}
              className="btn btn-sm btn-primary"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Custom Skill</span>
            </button>
            <button
              onClick={() => setShowAddServerModal(true)}
              className="btn btn-sm btn-secondary"
            >
              <Server className="w-3.5 h-3.5 text-cyan-400" />
              <span>Add MCP Server</span>
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

      {/* SECTION 1: MCP SERVERS — annotated as already-standardized; left untouched. */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="panel-section-title">
            <Server className="w-4 h-4 text-cyan-400" /> Active Model Context Protocol Servers ({servers.length})
          </h3>
          <button
            onClick={loadData}
            className="text-xs font-mono text-slate-400 hover:text-cyan-300 flex items-center gap-1 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Status</span>
          </button>
        </div>

        <div className="mcp-server-list">
          {servers.map((srv) => (
            <div key={srv.id} className="panel-card compact mcp-server-card">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {srv.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handlePingServer(srv.id)}
                      className="p-1 text-slate-400 hover:text-cyan-300 transition-colors"
                      title="Ping MCP Server Endpoint"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                    {srv.type !== 'built-in' && (
                      <button
                        onClick={() => handleDeleteServer(srv.id)}
                        className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                        title="Delete Server"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <StatusBadge status={srv.status === 'connected' ? 'online' : 'offline'} icon={<CheckCircle2 className="w-3 h-3" />}>
                    {srv.status.toUpperCase()} ({srv.latencyMs}ms)
                  </StatusBadge>
                  <StatusBadge status="info" className="uppercase">{srv.type}</StatusBadge>
                </div>

                <div className="text-xs font-mono text-slate-400 truncate">{srv.endpoint}</div>
              </div>

              {/* Exposed Tools */}
              <div className="space-y-2 pt-3 border-t border-slate-800">
                <span className="text-xs font-mono text-slate-400 block">Exposed Tools ({srv.tools.length}):</span>
                <div className="flex flex-wrap gap-1">
                  {srv.tools.map((t, idx) => (
                    <button
                      key={idx}
                      onClick={() => setToolTester({ server: srv, tool: t })}
                      className="btn btn-sm btn-secondary"
                      title="Click to test executing this tool"
                    >
                      <Play className="w-2.5 h-2.5" />
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2: INTEGRATED & CUSTOM SLASH SKILLS */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h3 className="panel-section-title">
            <Terminal className="w-4 h-4 text-cyan-400" /> Integrated & Custom Slash Skills ({skills.length})
          </h3>

          <div className="relative" style={{ minWidth: '220px' }}>
            <Search className="w-3.5 h-3.5 absolute text-slate-500" style={{ left: '10px', top: '9px' }} />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search skills or /slash command..."
              className="form-input text-xs font-mono"
              style={{ paddingLeft: '32px' }}
            />
          </div>
        </div>

        {/* Real skills.sh import (github.com/vercel-labs/skills' SKILL.md format) —
            see lib/skills-source.mjs for the fetch/parse logic this calls into. */}
        <PanelCard padding="compact">
          <form onSubmit={handleImportSkill} className="flex items-center gap-2 flex-wrap">
            <Download className="w-4 h-4 text-cyan-400 shrink-0" />
            <input
              type="text"
              value={importSource}
              onChange={(e) => setImportSource(e.target.value)}
              placeholder="Import from skills.sh — owner/repo, owner/repo@ref, or a github.com URL"
              className="form-input flex-1 text-xs font-mono"
              style={{ minWidth: '260px' }}
            />
            <button type="submit" className="btn btn-sm btn-primary" disabled={importing || !importSource.trim()}>
              {importing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              <span>{importing ? 'Importing...' : 'Import Skill'}</span>
            </button>
            <a
              href="https://www.skills.sh"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-cyan-400 flex items-center gap-1"
              title="Browse the skills.sh directory"
            >
              <ExternalLink className="w-3 h-3" /> Browse skills.sh
            </a>
          </form>
          {importError && <p className="text-xs text-danger mt-2">{importError}</p>}
        </PanelCard>

        <div className="mcp-skills-grid">
          {/* Skill Cards List */}
          <div className="space-y-3 mcp-skill-list">
            {filteredSkills.map((skill) => {
              const isSelected = skill.id === selectedSkillId;
              return (
                <div
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`panel-card compact cursor-pointer transition-all flex items-center justify-between font-mono ${
                    isSelected
                      ? 'border-cyan-500 text-cyan-300'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="space-y-1 mcp-skill-summary">
                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{skill.name}</span>
                      <span className="text-xs text-cyan-400 font-bold bg-slate-950 px-2 rounded-md border border-slate-800">
                        {skill.slashCommand}
                      </span>
                      {skill.author?.startsWith('skills.sh:') && (
                        <StatusBadge status="purple" className="text-caption">skills.sh</StatusBadge>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 font-sans line-clamp-1">{skill.description}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportSkill(skill.id);
                      }}
                      className="p-1 text-slate-500 hover:text-cyan-300 transition-colors"
                      title="Export as SKILL.md"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSkill(skill.id);
                      }}
                      className="p-1 transition-colors"
                      title={skill.enabled ? 'Disable Skill' : 'Enable Skill'}
                    >
                      {skill.enabled ? (
                        <ToggleRight className="w-6 h-6 text-emerald-400" />
                      ) : (
                        <ToggleLeft className="w-6 h-6 text-muted" />
                      )}
                    </button>

                    {skill.type !== 'built-in' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSkill(skill.id);
                        }}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                        title="Delete Custom Skill"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Active Skill Inspector & Test Console */}
          {activeSkill ? (
            <div className="panel-card mcp-skill-inspector font-mono">
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-base font-bold text-slate-100">{activeSkill.name}</h4>
                    <span className="text-xs font-bold text-cyan-400 bg-slate-950 px-2 rounded-md border border-slate-800">
                      {activeSkill.slashCommand}
                    </span>
                    <StatusBadge status="info" className="uppercase">{activeSkill.type}</StatusBadge>
                  </div>
                  <p className="text-xs text-slate-400 font-sans mt-1">{activeSkill.description}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => handleExportSkill(activeSkill.id)} className="btn btn-sm btn-secondary">
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Export</span>
                  </button>
                  <button onClick={() => openEditSkill(activeSkill)} className="btn btn-sm btn-secondary">
                    <Edit className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Edit</span>
                  </button>
                </div>
              </div>

              {/* Source Code */}
              <div className="space-y-2">
                <span className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-cyan-400" /> Subroutine Source Code (JavaScript / Async Function)
                </span>
                <pre
                  className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-emerald-400 overflow-x-auto"
                  style={{ maxHeight: '192px', lineHeight: 1.6 }}
                >
                  {activeSkill.code}
                </pre>
              </div>

              {/* Interactive Skill Test Console */}
              <div className="space-y-3 pt-3 border-t border-slate-800">
                <span className="text-xs text-slate-300 font-bold flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-amber-400" /> Interactive Skill Execution Test Console
                </span>

                <form onSubmit={handleTestSkill} className="flex gap-2">
                  <input
                    type="text"
                    value={testSkillInput}
                    onChange={(e) => setTestSkillInput(e.target.value)}
                    placeholder={`Enter test input for ${activeSkill.slashCommand} (e.g. 50 * 4 or query)...`}
                    className="form-input flex-1 text-xs font-mono"
                  />
                  <button
                    type="submit"
                    disabled={skillTesting}
                    className="btn"
                    style={{ background: 'var(--amber-400)', color: 'var(--surface-panel)', fontWeight: 700 }}
                  >
                    {skillTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>Run Skill</span>
                  </button>
                </form>

                {skillTestResult && (
                  <div className="bg-slate-950 p-3 rounded-xl border border-amber text-xs text-slate-200 font-mono space-y-1">
                    <div className="text-caption text-amber-400 font-bold">Execution Output:</div>
                    <pre className="whitespace-pre-wrap text-emerald-300 font-mono overflow-y-auto" style={{ maxHeight: '144px' }}>
                      {skillTestResult}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="panel-card mcp-skill-inspector text-center text-slate-500 font-mono text-xs">
              Select a skill to inspect source code and execute tests.
            </div>
          )}
        </div>
      </div>

      {/* MODAL: ADD MCP SERVER */}
      <Modal
        isOpen={showAddServerModal}
        onClose={() => setShowAddServerModal(false)}
        title="Add Model Context Protocol Server"
        icon={<Server className="w-4 h-4 text-cyan-400" />}
        maxWidth="480px"
      >
        <form onSubmit={handleAddServerSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="form-label">Server Name</label>
            <input
              type="text"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              placeholder="e.g. Postgres DB MCP Server"
              className="form-input"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="form-label">Protocol Type</label>
            <select
              value={newServerType}
              onChange={(e) => setNewServerType(e.target.value)}
              className="form-input"
            >
              <option value="http">HTTP JSON-RPC Endpoint</option>
              <option value="sse" disabled>Server-Sent Events (SSE) — not yet supported</option>
              <option value="stdio">Local Stdio Command Process</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="form-label">Endpoint URL / Stdio Command</label>
            <input
              type="text"
              value={newServerEndpoint}
              onChange={(e) => setNewServerEndpoint(e.target.value)}
              placeholder="e.g. http://localhost:8084/mcp/v1"
              className="form-input"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowAddServerModal(false)} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Register Server
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: ADD / EDIT SKILL */}
      <Modal
        isOpen={showAddSkillModal}
        onClose={() => setShowAddSkillModal(false)}
        title={editingSkill ? 'Edit Custom Skill' : 'Create Custom Slash Skill'}
        icon={<Code className="w-4 h-4 text-cyan-400" />}
        maxWidth="520px"
      >
        <form onSubmit={handleSaveSkillSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="form-label">Skill Display Name</label>
              <input
                type="text"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                placeholder="e.g. Weather Radar"
                className="form-input"
                required
              />
            </div>

            <div className="space-y-1">
              <label className="form-label">Slash Command Trigger</label>
              <input
                type="text"
                value={skillCmd}
                onChange={(e) => setSkillCmd(e.target.value)}
                placeholder="e.g. /weather"
                className="form-input text-cyan-300 font-bold"
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="form-label">Description</label>
            <input
              type="text"
              value={skillDesc}
              onChange={(e) => setSkillDesc(e.target.value)}
              placeholder="e.g. Fetches local weather forecast data"
              className="form-input"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="form-label">JavaScript / Async Subroutine Code</label>
            <textarea
              value={skillCode}
              onChange={(e) => setSkillCode(e.target.value)}
              placeholder="async function execute({ input, app }) { ... }"
              className="form-input text-emerald-400 font-mono text-xs"
              style={{ height: '144px' }}
              required
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowAddSkillModal(false)} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Skill
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: TOOL TESTER */}
      <Modal
        isOpen={Boolean(toolTester)}
        onClose={() => setToolTester(null)}
        title={`Execute Tool: ${toolTester?.tool.name || ''}`}
        icon={<Play className="w-4 h-4 text-cyan-400" />}
        maxWidth="520px"
      >
        {toolTester && (
          <>
            <p className="text-xs text-slate-400 font-sans mb-3">
              Server: {toolTester.server.name} ({toolTester.server.endpoint})
            </p>

            <form onSubmit={handleExecuteTool} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="form-label">Tool Parameters (JSON or string)</label>
                <textarea
                  value={toolParams}
                  onChange={(e) => setToolParams(e.target.value)}
                  placeholder='{ "path": "README.md" }'
                  className="form-input text-cyan-300 font-mono text-xs"
                  style={{ height: '112px' }}
                />
              </div>

              <button
                type="submit"
                disabled={toolExecuting}
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
              >
                {toolExecuting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>Execute Tool</span>
              </button>
            </form>

            {toolResult && (
              <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-cyan text-xs">
                <div className="text-cyan-400 font-bold text-caption">Execution Result Output:</div>
                <pre className="whitespace-pre-wrap text-emerald-300 font-mono overflow-y-auto" style={{ maxHeight: '192px', lineHeight: 1.6 }}>
                  {toolResult}
                </pre>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
