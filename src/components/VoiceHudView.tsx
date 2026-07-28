import React, { useState } from 'react';
import { VoiceOrb } from './VoiceOrb';
import { PersonaConfig, VoiceStatus, Message } from '../types';
import {
  Mic,
  MicOff,
  Square,
  Sparkles,
  Zap,
  Volume2,
  Terminal,
  Search,
  Calculator,
  Cpu
} from 'lucide-react';

interface VoiceHudViewProps {
  persona: PersonaConfig;
  voiceStatus: VoiceStatus;
  onToggleListen: () => void;
  onInterrupt: () => void;
  lastMessage?: Message;
  transcript: string;
  onSendQuickCommand: (cmd: string) => void;
  isContinuousListening: boolean;
  onToggleContinuous: () => void;
}

export const VoiceHudView: React.FC<VoiceHudViewProps> = ({
  persona,
  voiceStatus,
  onToggleListen,
  onInterrupt,
  lastMessage,
  transcript,
  onSendQuickCommand,
  isContinuousListening,
  onToggleContinuous
}) => {
  const [quickInput, setQuickInput] = useState('');

  const quickSlashPrompts = [
    { label: 'System Hardware', command: '/hardware' },
    { label: 'Search AI News', command: '/search recent breakthroughs in local LLMs' },
    { label: 'Evaluate Math', command: '/calc 1024 * 16 / 4' },
    { label: 'Cloud Escalate', command: '/escalate Write a rust macro for async pipeline' },
    { label: 'MCP Status', command: '/mcp' }
  ];

  const handleQuickSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickInput.trim()) return;
    onSendQuickCommand(quickInput.trim());
    setQuickInput('');
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex flex-col items-center justify-between p-4 sm:p-8 bg-[#0a0a0b] text-slate-100 relative overflow-hidden">
      {/* Background Cyber Grid Graphic */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b12_1px,transparent_1px),linear-gradient(to_bottom,#1e293b12_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

      {/* Top Voice HUD Status Banner */}
      <div className="z-10 flex flex-col items-center text-center max-w-xl mx-auto space-y-2">
        <div className="flex items-center gap-2 px-3 py-1 rounded-full glass border-subtle text-cyan-400 text-xs font-mono backdrop-blur-md glow-cyan">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>VOICE INTELLIGENCE ACTIVE</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-light font-mono text-slate-100 tracking-tight">
          "{persona.greeting}"
        </h2>
        <p className="text-sm text-slate-400 font-mono">
          Speak naturally or click the orb to trigger voice capture
        </p>
      </div>

      {/* Center Interactive Orb & Waveform Visualizer */}
      <div className="z-10 my-6 flex flex-col items-center justify-center relative w-full max-w-3xl">
        <VoiceOrb
          status={voiceStatus}
          accentColor={persona.accentColor}
          onClick={onToggleListen}
          size={300}
        />

        {/* Dynamic Waveform Bars */}
        <div className="flex items-end justify-center space-x-1 h-12 my-3">
          <div className={`waveform-bar ${voiceStatus === 'listening' ? 'h-8 animate-pulse' : voiceStatus === 'speaking' ? 'h-10' : 'h-3'}`} />
          <div className={`waveform-bar ${voiceStatus === 'listening' ? 'h-12 animate-pulse' : voiceStatus === 'speaking' ? 'h-11' : 'h-5'}`} />
          <div className={`waveform-bar ${voiceStatus === 'listening' ? 'h-6 animate-pulse' : voiceStatus === 'speaking' ? 'h-8' : 'h-2'}`} />
          <div className={`waveform-bar ${voiceStatus === 'listening' ? 'h-10 animate-pulse' : voiceStatus === 'speaking' ? 'h-12' : 'h-6'}`} />
          <div className={`waveform-bar ${voiceStatus === 'listening' ? 'h-5 animate-pulse' : voiceStatus === 'speaking' ? 'h-7' : 'h-3'}`} />
        </div>

        {/* Live Speech Transcript Box */}
        <div className="w-full max-w-2xl glass rounded-2xl p-5 border-subtle shadow-2xl backdrop-blur-xl text-center min-h-[90px] flex flex-col items-center justify-center">
          {voiceStatus === 'listening' ? (
            <div className="flex items-center gap-3 text-cyan-400 font-mono text-sm animate-pulse">
              <Mic className="w-4 h-4 text-cyan-400" />
              <span>{transcript || 'Listening for voice command...'}</span>
            </div>
          ) : voiceStatus === 'processing' ? (
            <div className="flex items-center gap-3 text-cyan-400 font-mono text-sm animate-pulse">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>Analyzing query with neural core...</span>
            </div>
          ) : lastMessage ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-center gap-2 text-xs font-mono text-slate-400">
                <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-slate-300 font-semibold">{lastMessage.modelUsed || persona.name}</span>
                {lastMessage.isCloudEscalated && (
                  <span className="bg-purple-950/80 text-purple-300 text-[10px] px-2 py-0.5 rounded border border-purple-800/60 font-mono">
                    Cloud Escalated
                  </span>
                )}
              </div>
              <p className="text-slate-200 text-sm sm:text-base leading-relaxed font-sans max-w-xl">
                {lastMessage.text}
              </p>
            </div>
          ) : (
            <p className="text-slate-500 text-sm font-mono italic">
              "JARVIS, run system check" or ask any question...
            </p>
          )}
        </div>
      </div>

      {/* Control Buttons Bar */}
      <div className="z-10 w-full max-w-xl space-y-6">
        <div className="flex items-center justify-center gap-4">
          {/* Push To Talk / Listen toggle */}
          <button
            onClick={onToggleListen}
            className={`flex items-center gap-2.5 px-6 py-3 rounded-xl font-mono text-sm font-medium transition-all shadow-xl ${
              voiceStatus === 'listening'
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/50 animate-pulse'
                : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold shadow-cyan-500/20 glow-cyan'
            }`}
          >
            {voiceStatus === 'listening' ? (
              <>
                <MicOff className="w-4 h-4" />
                <span>Stop Listening</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Start Listening</span>
              </>
            )}
          </button>

          {/* Interrupt JARVIS Button */}
          <button
            onClick={onInterrupt}
            disabled={voiceStatus === 'idle'}
            className="flex items-center gap-2 px-4 py-3 rounded-xl font-mono text-sm glass text-rose-300 border-subtle hover:border-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Immediately interrupt speech output or current request"
          >
            <Square className="w-4 h-4 text-rose-400 fill-rose-400" />
            <span>Interrupt</span>
          </button>

          {/* Continuous Listening Toggle */}
          <button
            onClick={onToggleContinuous}
            className={`px-3 py-3 rounded-xl text-xs font-mono transition-colors ${
              isContinuousListening
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50 glow-emerald'
                : 'glass text-slate-400 border-subtle hover:text-slate-200'
            }`}
            title="Toggle continuous wake-word listening loop"
          >
            {isContinuousListening ? 'Continuous ON' : 'Continuous OFF'}
          </button>
        </div>

        {/* Quick Slash Prompts Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400 px-1">
            <span className="flex items-center gap-1 text-slate-400">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" /> Quick Slash Commands
            </span>
            <span className="text-slate-500">Tap to run</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {quickSlashPrompts.map((p, idx) => (
              <button
                key={idx}
                onClick={() => onSendQuickCommand(p.command)}
                className="px-3 py-1.5 rounded-lg text-xs font-mono glass hover:bg-white/5 text-cyan-300 border-subtle hover:border-cyan-500/40 transition-all flex items-center gap-1.5 shadow-md"
              >
                <span>{p.label}</span>
                <span className="text-[10px] text-slate-500">{p.command.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Quick Text Input Fallback Doorway */}
        <form onSubmit={handleQuickSubmit} className="relative">
          <input
            type="text"
            value={quickInput}
            onChange={(e) => setQuickInput(e.target.value)}
            placeholder="Type a command or query (e.g. /search AI breakthroughs)..."
            className="w-full glass border-subtle focus:border-cyan-500/60 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 font-mono focus:outline-none shadow-xl pr-16"
          />
          <button
            type="submit"
            className="absolute right-2 top-2 px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold transition-all glow-cyan"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
