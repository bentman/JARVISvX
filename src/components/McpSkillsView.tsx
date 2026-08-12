import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { McpServer, McpTool, SkillModule } from '../types';
import {
  Zap,
  Server,
  Code,
  CheckCircle2,
  AlertCircle,
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
  Check
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

  const activeSkill = skills.find((s) => s.id === selectedSkillId) || skills[0];

  const filteredSkills = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.slashCommand.toLowerCase().includes(searchFilter.toLowerCase()) ||
      s.description.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="p-4 sm:p-8 bg-[#0a0a0b] text-slate-100 max-w-6xl mx-auto space-y-8 font-sans min-h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider mb-1">
            <Zap className="w-4 h-4" /> Model Context Protocol & Extensible Runtime Engine
          </div>
          <h2 className="text-2xl sm:text-3xl font-light font-mono text-slate-100">
            MCP Servers & Dynamic Slash Skills
          </h2>
        </div>
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
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold transition-all shadow-md"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Custom Skill</span>
          </button>
          <button
            onClick={() => setShowAddServerModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 font-mono text-xs transition-all"
          >
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span>Add MCP Server</span>
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

      {/* SECTION 1: MCP SERVERS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-mono text-slate-200 flex items-center gap-2">
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

        <div className="grid grid-cols-3">
          {servers.map((srv) => (
            <div key={srv.id} className="panel-card">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono font-bold text-slate-100 truncate max-w-[170px]">
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
                  <span
                    className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
                      srv.status === 'connected'
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : 'bg-rose-950 text-rose-400 border-rose-800'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" /> {srv.status.toUpperCase()} ({srv.latencyMs}ms)
                  </span>
                  <span className="text-[10px] font-mono bg-slate-950 text-slate-400 px-2 py-0.5 rounded border border-slate-800 uppercase">
                    {srv.type}
                  </span>
                </div>

                <div className="text-[11px] font-mono text-slate-400 truncate">{srv.endpoint}</div>
              </div>

              {/* Exposed Tools */}
              <div className="space-y-1.5 pt-3 border-t border-slate-800/80">
                <span className="text-[11px] font-mono text-slate-400 block">Exposed Tools ({srv.tools.length}):</span>
                <div className="flex flex-wrap gap-1">
                  {srv.tools.map((t, idx) => (
                    <button
                      key={idx}
                      onClick={() => setToolTester({ server: srv, tool: t })}
                      className="text-[10px] font-mono bg-slate-950 hover:bg-cyan-950 hover:text-cyan-300 text-cyan-400 px-2 py-1 rounded border border-slate-800 hover:border-cyan-700 transition-all flex items-center gap-1"
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h3 className="text-lg font-mono text-slate-200 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" /> Integrated & Custom Slash Skills ({skills.length})
          </h3>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search skills or /slash command..."
              className="w-full bg-slate-900 border border-slate-800 focus:border-cyan-500 rounded-xl pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Skill Cards List */}
          <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
            {filteredSkills.map((skill) => {
              const isSelected = skill.id === selectedSkillId;
              return (
                <div
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all flex items-center justify-between font-mono ${
                    isSelected
                      ? 'bg-slate-900 border-cyan-500/80 text-cyan-300 shadow-xl'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <div className="space-y-1 max-w-[80%]">
                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <span>{skill.name}</span>
                      <span className="text-xs text-cyan-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {skill.slashCommand}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 font-sans line-clamp-1">{skill.description}</div>
                  </div>

                  <div className="flex items-center gap-2">
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
                        <ToggleLeft className="w-6 h-6 text-slate-600" />
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
            <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl font-mono">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-100">{activeSkill.name}</h4>
                    <span className="text-xs font-bold text-cyan-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                      {activeSkill.slashCommand}
                    </span>
                    <span className="text-[10px] uppercase bg-slate-950 text-slate-400 px-2 py-0.5 rounded border border-slate-800">
                      {activeSkill.type}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 font-sans mt-1">{activeSkill.description}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditSkill(activeSkill)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition-colors"
                  >
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
                <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-emerald-400 overflow-x-auto leading-relaxed max-h-48">
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
                    className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={skillTesting}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl transition-all flex items-center gap-1.5"
                  >
                    {skillTesting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>Run Skill</span>
                  </button>
                </form>

                {skillTestResult && (
                  <div className="bg-slate-950 p-3 rounded-xl border border-amber-500/30 text-xs text-slate-200 font-mono space-y-1">
                    <div className="text-[10px] text-amber-400 font-bold">Execution Output:</div>
                    <pre className="whitespace-pre-wrap text-emerald-300 font-mono max-h-36 overflow-y-auto">
                      {skillTestResult}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="lg:col-span-2 bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-500 font-mono text-xs">
              Select a skill to inspect source code and execute tests.
            </div>
          )}
        </div>
      </div>

      {/* MODAL: ADD MCP SERVER */}
      {showAddServerModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-400" /> Add Model Context Protocol Server
              </h3>
              <button onClick={() => setShowAddServerModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddServerSubmit} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Server Name</label>
                <input
                  type="text"
                  value={newServerName}
                  onChange={(e) => setNewServerName(e.target.value)}
                  placeholder="e.g. Postgres DB MCP Server"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Protocol Type</label>
                <select
                  value={newServerType}
                  onChange={(e) => setNewServerType(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  <option value="http">HTTP JSON-RPC Endpoint</option>
                  <option value="sse">Server-Sent Events (SSE)</option>
                  <option value="stdio">Local Stdio Command Process</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Endpoint URL / Stdio Command</label>
                <input
                  type="text"
                  value={newServerEndpoint}
                  onChange={(e) => setNewServerEndpoint(e.target.value)}
                  placeholder="e.g. http://localhost:8084/mcp/v1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddServerModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400">
                  Register Server
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ADD / EDIT SKILL */}
      {showAddSkillModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl font-mono max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Code className="w-4 h-4 text-cyan-400" />
                {editingSkill ? 'Edit Custom Skill' : 'Create Custom Slash Skill'}
              </h3>
              <button onClick={() => setShowAddSkillModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveSkillSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-400">Skill Display Name</label>
                  <input
                    type="text"
                    value={skillName}
                    onChange={(e) => setSkillName(e.target.value)}
                    placeholder="e.g. Weather Radar"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-slate-400">Slash Command Trigger</label>
                  <input
                    type="text"
                    value={skillCmd}
                    onChange={(e) => setSkillCmd(e.target.value)}
                    placeholder="e.g. /weather"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-cyan-300 font-bold focus:outline-none focus:border-cyan-500"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">Description</label>
                <input
                  type="text"
                  value={skillDesc}
                  onChange={(e) => setSkillDesc(e.target.value)}
                  placeholder="e.g. Fetches local weather forecast data"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-400">JavaScript / Async Subroutine Code</label>
                <textarea
                  value={skillCode}
                  onChange={(e) => setSkillCode(e.target.value)}
                  placeholder="async function execute({ input, app }) { ... }"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-emerald-400 focus:outline-none focus:border-cyan-500 h-36 font-mono text-xs leading-relaxed"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSkillModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400">
                  Save Skill
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TOOL TESTER */}
      {toolTester && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 max-w-lg w-full space-y-4 shadow-2xl font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <Play className="w-4 h-4 text-cyan-400" /> Execute Tool: {toolTester.tool.name}
                </h3>
                <p className="text-xs text-slate-400 font-sans mt-0.5">
                  Server: {toolTester.server.name} ({toolTester.server.endpoint})
                </p>
              </div>
              <button onClick={() => setToolTester(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteTool} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-slate-400">Tool Parameters (JSON or string)</label>
                <textarea
                  value={toolParams}
                  onChange={(e) => setToolParams(e.target.value)}
                  placeholder='{ "path": "README.md" }'
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-cyan-300 focus:outline-none focus:border-cyan-500 h-28 font-mono text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={toolExecuting}
                className="w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all flex items-center justify-center gap-2"
              >
                {toolExecuting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                <span>Execute Tool</span>
              </button>
            </form>

            {toolResult && (
              <div className="space-y-1 bg-slate-950 p-3 rounded-xl border border-cyan-500/30 text-xs">
                <div className="text-cyan-400 font-bold text-[10px]">Execution Result Output:</div>
                <pre className="whitespace-pre-wrap text-emerald-300 font-mono max-h-48 overflow-y-auto leading-relaxed">
                  {toolResult}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

