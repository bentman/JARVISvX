import React, { useState } from 'react';
import { McpServer, SkillModule } from '../types';
import {
  Zap,
  Server,
  Code,
  CheckCircle2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
  Terminal,
  Cpu,
  Layers
} from 'lucide-react';

interface McpSkillsViewProps {
  mcpServers: McpServer[];
  skills: SkillModule[];
  onToggleSkill: (id: string) => void;
}

export const McpSkillsView: React.FC<McpSkillsViewProps> = ({
  mcpServers,
  skills,
  onToggleSkill
}) => {
  const [selectedSkillId, setSelectedSkillId] = useState<string>(skills[0]?.id || '');

  const activeSkill = skills.find((s) => s.id === selectedSkillId) || skills[0];

  return (
    <div className="p-4 sm:p-8 bg-slate-950 text-slate-100 max-w-6xl mx-auto space-y-8 font-sans">
      {/* View Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider mb-1">
          <Zap className="w-4 h-4" /> Extensible Agent Tooling Matrix
        </div>
        <h2 className="text-2xl sm:text-3xl font-light font-mono text-slate-100">
          Model Context Protocol (MCP) & Slash Skills
        </h2>
      </div>

      {/* MCP Servers Grid */}
      <div className="space-y-4">
        <h3 className="text-lg font-mono text-slate-200 flex items-center gap-2">
          <Server className="w-4 h-4 text-cyan-400" /> Active MCP Servers
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {mcpServers.map((srv) => (
            <div
              key={srv.id}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-xl backdrop-blur-md hover:border-cyan-500/40 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-slate-200">{srv.name}</span>
                <span className="flex items-center gap-1 text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                  <CheckCircle2 className="w-3 h-3" /> Connected ({srv.latencyMs}ms)
                </span>
              </div>

              <div className="text-xs font-mono text-slate-400 truncate">{srv.endpoint}</div>

              <div className="space-y-1 pt-2 border-t border-slate-800/80">
                <span className="text-[11px] font-mono text-slate-400 block">Exposed MCP Tools ({srv.tools.length}):</span>
                <div className="flex flex-wrap gap-1">
                  {srv.tools.map((t, idx) => (
                    <span
                      key={idx}
                      className="text-[10px] font-mono bg-slate-950 text-cyan-300 px-2 py-0.5 rounded border border-slate-800"
                    >
                      {t.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Slash Skills Matrix Section */}
      <div className="space-y-4">
        <h3 className="text-lg font-mono text-slate-200 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-cyan-400" /> Integrated Slash Commands & Skills
        </h3>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Skill List */}
          <div className="space-y-3">
            {skills.map((skill) => {
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
                  <div className="space-y-1">
                    <div className="text-sm font-bold text-slate-100 flex items-center gap-2">
                      <span>{skill.name}</span>
                      <span className="text-xs text-cyan-400 font-bold bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        {skill.slashCommand}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 font-sans line-clamp-1">
                      {skill.description}
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSkill(skill.id);
                    }}
                    className="text-slate-400 hover:text-cyan-300 p-1 transition-colors"
                  >
                    {skill.enabled ? (
                      <ToggleRight className="w-6 h-6 text-emerald-400" />
                    ) : (
                      <ToggleLeft className="w-6 h-6 text-slate-600" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Active Skill Code Inspector */}
          {activeSkill && (
            <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl font-mono">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h4 className="text-base font-bold text-slate-100">{activeSkill.name}</h4>
                  <p className="text-xs text-slate-400 font-sans mt-0.5">{activeSkill.description}</p>
                </div>
                <div className="text-xs text-slate-500">
                  Author: {activeSkill.author} (v{activeSkill.version})
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-cyan-400" /> Subroutine Source Code (TypeScript)
                </span>
                <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-emerald-400 overflow-x-auto leading-relaxed font-mono">
                  {activeSkill.code}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
