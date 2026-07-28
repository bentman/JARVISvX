import React, { useState, useRef, useEffect } from 'react';
import { PersonaConfig } from '../types';
import { Terminal as TerminalIcon, Sparkles, Play, Trash2, HelpCircle } from 'lucide-react';

interface CliTerminalViewProps {
  persona: PersonaConfig;
  onExecuteCommand: (cmd: string) => Promise<{ text: string; modelUsed?: string }>;
}

interface TerminalLog {
  id: string;
  type: 'input' | 'output' | 'system';
  content: string;
  timestamp: string;
  modelUsed?: string;
}

export const CliTerminalView: React.FC<CliTerminalViewProps> = ({
  persona,
  onExecuteCommand
}) => {
  const [logs, setLogs] = useState<TerminalLog[]>([
    {
      id: 'log-1',
      type: 'system',
      content: `===========================================================\n  JARVIS LOCAL-FIRST PERSONAL AI ASSISTANT (v3.8)\n  OPERATING SYSTEM: Local-First Neural OS\n  LLM RUNNER: Llama-3.2-3B-Instruct (42.5 t/s)\n  CLOUD FALLBACK: Gemini 3.6 Flash Standby\n===========================================================\nType '/help' or enter any slash command to begin.`,
      timestamp: new Date().toLocaleTimeString()
    }
  ]);
  const [inputVal, setInputVal] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const handleCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || isProcessing) return;

    const cmdText = inputVal.trim();
    setInputVal('');

    // Add user input log
    const userLog: TerminalLog = {
      id: `usr-${Date.now()}`,
      type: 'input',
      content: cmdText,
      timestamp: new Date().toLocaleTimeString()
    };

    setLogs((prev) => [...prev, userLog]);

    if (cmdText === '/clear') {
      setLogs([]);
      return;
    }

    if (cmdText === '/help') {
      setLogs((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          type: 'system',
          content: `JARVIS TERMINAL SLASH COMMANDS:\n  /search <query>   - Grounded web search via Gemini / Local index\n  /calc <expr>     - Safe mathematical expression evaluator\n  /hardware        - System CPU, RAM, GPU and benchmark telemetry\n  /mcp             - Query connected Model Context Protocol servers\n  /code <prompt>   - Self-evolution TypeScript skill generator\n  /escalate <p>    - Explicitly escalate reasoning to Gemini Cloud\n  /clear           - Clear terminal logs`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      return;
    }

    setIsProcessing(true);

    try {
      const res = await onExecuteCommand(cmdText);
      const outputLog: TerminalLog = {
        id: `out-${Date.now()}`,
        type: 'output',
        content: res.text,
        modelUsed: res.modelUsed,
        timestamp: new Date().toLocaleTimeString()
      };
      setLogs((prev) => [...prev, outputLog]);
    } catch (err: any) {
      setLogs((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: 'system',
          content: `ERROR: Failed to execute command. ${err.message || ''}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-70px)] bg-[#0a0a0b] p-4 sm:p-6 flex flex-col font-mono text-xs text-slate-100 max-w-6xl mx-auto">
      {/* Terminal Title Bar */}
      <div className="glass border-subtle rounded-t-2xl px-4 py-3 flex items-center justify-between text-slate-400 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-rose-500/80" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80" />
            <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
          </div>
          <span className="ml-2 text-cyan-300 font-bold flex items-center gap-1.5">
            <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" /> jarvis@local-first-box:~$
          </span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-emerald-400 font-bold">● LOCAL ONLINE</span>
          <button
            onClick={() => setLogs([])}
            className="hover:text-rose-400 transition-colors p-1"
            title="Clear Terminal Logs"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Output Body */}
      <div className="flex-1 glass border-x border-b border-subtle rounded-b-2xl p-4 sm:p-6 space-y-4 overflow-y-auto max-h-[600px] shadow-2xl backdrop-blur-md">
        {logs.map((log) => (
          <div key={log.id} className="space-y-1">
            {log.type === 'input' && (
              <div className="flex items-center gap-2 text-cyan-400 font-bold">
                <span>jarvis@local-first-box:~$</span>
                <span className="text-slate-100">{log.content}</span>
              </div>
            )}

            {log.type === 'output' && (
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 space-y-1 text-slate-200">
                <div className="flex items-center justify-between text-[10px] text-slate-500 border-b border-slate-800/60 pb-1">
                  <span className="text-cyan-400 font-bold">[{persona.name} Response]</span>
                  {log.modelUsed && <span>Model: {log.modelUsed}</span>}
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs text-slate-200 leading-relaxed font-sans">
                  {log.content}
                </pre>
              </div>
            )}

            {log.type === 'system' && (
              <pre className="text-emerald-400/90 font-mono whitespace-pre-wrap leading-relaxed bg-emerald-950/20 p-3 rounded-xl border border-emerald-900/40">
                {log.content}
              </pre>
            )}
          </div>
        ))}

        {isProcessing && (
          <div className="text-cyan-400 animate-pulse flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 animate-spin" />
            <span>Processing command on neural core...</span>
          </div>
        )}

        <div ref={terminalEndRef} />
      </div>

      {/* Terminal Command Input Form */}
      <form onSubmit={handleCommandSubmit} className="mt-4 relative">
        <div className="flex items-center bg-slate-900 border border-slate-800 focus-within:border-cyan-500 rounded-xl px-4 py-3 shadow-xl">
          <span className="text-cyan-400 font-bold mr-2">jarvis@local-box:~$</span>
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Type command or slash tool (e.g. /search quantum computing or /calc 2^10)..."
            className="flex-1 bg-transparent text-slate-100 focus:outline-none font-mono text-xs placeholder-slate-600"
          />
          <button
            type="submit"
            disabled={!inputVal.trim() || isProcessing}
            className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold rounded text-xs transition-colors"
          >
            Run
          </button>
        </div>
      </form>
    </div>
  );
};
