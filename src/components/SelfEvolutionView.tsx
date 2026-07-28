import React, { useState } from 'react';
import { SkillModule } from '../types';
import { Code, Sparkles, CheckCircle2, Play, Plus, RefreshCw, Terminal, ArrowRight } from 'lucide-react';

interface SelfEvolutionViewProps {
  onInstallNewSkill: (skill: SkillModule) => void;
}

export const SelfEvolutionView: React.FC<SelfEvolutionViewProps> = ({
  onInstallNewSkill
}) => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [skillName, setSkillName] = useState('');
  const [slashCmd, setSlashCmd] = useState('');
  const [description, setDescription] = useState('');
  const [installedSuccess, setInstalledSuccess] = useState(false);

  const samplePrompts = [
    'Create a slash skill /weather to fetch local atmospheric radar data',
    'Build a skill /gitlog to inspect local commit history via git MCP',
    'Create a skill /benchmark to test CPU matrix multiplication speed'
  ];

  const handleGenerateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setInstalledSuccess(false);

    try {
      const res = await fetch('/api/self-evolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() })
      });
      const data = await res.json();

      setGeneratedCode(data.code || '// Self-evolved code generated');
      
      // Auto-extract command name
      const cmdMatch = prompt.match(/\/[a-zA-Z0-9_-]+/);
      const extractedCmd = cmdMatch ? cmdMatch[0] : '/custom';
      setSlashCmd(extractedCmd);
      setSkillName(`Evolved ${extractedCmd.replace('/', '').toUpperCase()} Skill`);
      setDescription(`Self-evolved subroutine generated for: ${prompt.trim().slice(0, 50)}...`);
    } catch (err) {
      setGeneratedCode(`// Evolved Subroutine Fallback\nexport async function executeSkill(input: string) {\n  return { success: true, result: "Evolved skill executed" };\n}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleInstall = () => {
    if (!generatedCode) return;
    const newSkill: SkillModule = {
      id: `skill-evolved-${Date.now()}`,
      name: skillName || 'Self-Evolved Skill',
      slashCommand: slashCmd.startsWith('/') ? slashCmd : `/${slashCmd}`,
      description: description || 'Autonomous self-evolved subroutine',
      code: generatedCode,
      enabled: true,
      type: 'custom',
      author: 'JARVIS Self-Evolution Engine',
      version: '1.0.0'
    };

    onInstallNewSkill(newSkill);
    setInstalledSuccess(true);
    setTimeout(() => setInstalledSuccess(false), 3000);
  };

  return (
    <div className="p-4 sm:p-8 bg-slate-950 text-slate-100 max-w-6xl mx-auto space-y-8 font-sans">
      {/* Header */}
      <div className="border-b border-slate-800 pb-6">
        <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs uppercase tracking-wider mb-1">
          <Code className="w-4 h-4" /> Autonomous Code Generator & Self-Improvement Studio
        </div>
        <h2 className="text-2xl sm:text-3xl font-light font-mono text-slate-100">
          JARVIS Self-Evolution Engine
        </h2>
        <p className="text-sm text-slate-400 mt-1 font-sans max-w-2xl">
          Empower JARVIS to program and integrate its own custom TypeScript skills and slash commands in real-time.
        </p>
      </div>

      {/* Prompt Generator Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-xl">
        <h3 className="text-base font-mono font-bold text-slate-200 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" /> Describe New Skill Subroutine
        </h3>

        <form onSubmit={handleGenerateSkill} className="space-y-4">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Create a new skill /loganalyzer to parse and aggregate server error logs..."
            className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl p-4 text-sm text-slate-100 placeholder-slate-500 font-mono focus:outline-none h-28 shadow-inner"
          />

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-slate-500">Sample Prompts:</span>
              {samplePrompts.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="text-[11px] font-mono bg-slate-950 hover:bg-slate-800 text-cyan-300 px-2.5 py-1 rounded border border-slate-800 transition-colors"
                >
                  {p.split(' ')[2]}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-mono text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-lg shadow-cyan-500/10"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Synthesizing Code...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Subroutine</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Generated Code Preview & Installation Panel */}
      {generatedCode && (
        <div className="bg-slate-900/90 border border-cyan-500/40 rounded-2xl p-6 space-y-6 shadow-2xl font-mono animate-fadeIn">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" /> Subroutine Code Generated
              </span>
              <h4 className="text-lg font-bold text-slate-100 mt-1">{skillName}</h4>
            </div>

            <button
              onClick={handleInstall}
              disabled={installedSuccess}
              className={`px-5 py-2.5 rounded-xl font-mono text-xs font-bold transition-all flex items-center gap-2 shadow-lg ${
                installedSuccess
                  ? 'bg-emerald-600 text-white shadow-emerald-900/50'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
              }`}
            >
              {installedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Skill Installed!</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  <span>Install Skill Into JARVIS</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Skill Display Name</label>
              <input
                type="text"
                value={skillName}
                onChange={(e) => setSkillName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Slash Command Trigger</label>
              <input
                type="text"
                value={slashCmd}
                onChange={(e) => setSlashCmd(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 font-bold text-cyan-300"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400">Description</label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-xs text-slate-400 font-bold flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" /> Compiled TypeScript Code
            </span>
            <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-emerald-400 overflow-x-auto leading-relaxed font-mono">
              {generatedCode}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
