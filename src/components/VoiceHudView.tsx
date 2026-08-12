import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { VoiceRuntimeStatus } from '../types';
import { VoiceOrb } from './VoiceOrb';
import {
  Mic,
  Square,
  Volume2,
  Radio,
  Terminal,
  Activity,
  CheckCircle2,
  Sparkles
} from 'lucide-react';

export function VoiceHudView() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceRuntimeStatus | null>(null);
  const [activeVoice, setActiveVoice] = useState('bf_isabella');
  const [activeMode, setActiveMode] = useState('wake');
  const [currentState, setCurrentState] = useState('wake-listening');
  const [audioLevel, setAudioLevel] = useState(0);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const refreshStatus = async () => {
    try {
      const status = await api.voice();
      setVoiceStatus(status);
      if (status.voice) setActiveVoice(status.voice);
      if (status.mode) setActiveMode(status.mode);
      if (status.state) setCurrentState(status.state);
    } catch (err: any) {
      setError(err.message || 'Failed to load voice status');
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  // Web Audio Micro-analyzer
  useEffect(() => {
    const initAudioAnalyzer = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) return;
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (!stream) return;
        streamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 32;
        analyserRef.current = analyser;

        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / (dataArray.length * 255);
          setAudioLevel(avg);
          animFrameRef.current = requestAnimationFrame(tick);
        };

        tick();
      } catch (e) {}
    };

    initAudioAnalyzer();

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') audioCtxRef.current.close();
    };
  }, []);

  const handleVoiceChange = async (voiceId: string) => {
    setActiveVoice(voiceId);
    try {
      await api.setVoice(voiceId);
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleModeChange = async (mode: string) => {
    setActiveMode(mode);
    try {
      await api.setVoiceMode(mode);
      await refreshStatus();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePushToTalk = async () => {
    try {
      await api.setVoiceState('capturing');
      setCurrentState('capturing');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleInterrupt = async () => {
    try {
      await api.voiceEvent({ type: 'interrupt' });
      await api.setVoiceState('wake-listening');
      setCurrentState('interrupted');
      setTimeout(() => setCurrentState('wake-listening'), 1200);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleExecuteQuickSkill = async (command: string) => {
    try {
      setLastTranscript(`Executing ${command}...`);
      const res = await api.executeSkill(command);
      setLastTranscript(res.output);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const kokoroVoicesList = [
    { id: 'bf_isabella', name: 'Isabella (British Soft)', tag: 'Recommended' },
    { id: 'af_sarah', name: 'Sarah (American Crisp)', tag: 'Popular' },
    { id: 'af_bella', name: 'Bella (American Expressive)', tag: 'Warm' },
    { id: 'am_adam', name: 'Adam (American Deep)', tag: 'Male' },
    { id: 'am_michael', name: 'Michael (American Clear)', tag: 'Male' },
    { id: 'bf_emma', name: 'Emma (British Formal)', tag: 'British' }
  ];

  return (
    <div className="p-4 sm:p-8 bg-[#0a0a0b] text-slate-100 max-w-5xl mx-auto space-y-6 font-sans min-h-[calc(100vh-80px)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <Radio className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="text-xl font-mono text-slate-100 font-medium">Voice Control Center</h2>
            <p className="text-xs font-mono text-slate-400">JARVIS Speech Intelligence Runtime</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-xl text-xs font-mono text-cyan-300">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span className="uppercase">{currentState}</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs font-mono flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:text-white">✕</button>
        </div>
      )}

      {/* Hero Presence Card - Clean & Organized */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center space-y-5 shadow-xl relative overflow-hidden backdrop-blur-md">
        {/* Soft Minimal Glowing Orb */}
        <VoiceOrb
          state={currentState}
          audioLevel={audioLevel}
          onOrbClick={handlePushToTalk}
          size={140}
        />

        {/* Status Descriptor */}
        <div className="text-center space-y-1">
          <p className="text-sm font-mono text-slate-200">
            {voiceStatus?.message || 'Listening locally for "Hey Jarvis"...'}
          </p>
        </div>

        {/* HUD Actions Bar */}
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={handlePushToTalk}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono text-xs font-bold transition-all shadow-md shadow-cyan-500/20"
          >
            <Mic className="w-3.5 h-3.5" /> Push-To-Talk
          </button>

          <button
            onClick={handleInterrupt}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-rose-900 text-slate-200 hover:text-rose-200 border border-slate-700 font-mono text-xs transition-all"
          >
            <Square className="w-3.5 h-3.5 text-rose-400" /> Interrupt Speech
          </button>

          <button
            onClick={() => handleModeChange(activeMode === 'wake' ? 'ptt' : 'wake')}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-400 border border-slate-800 font-mono text-xs transition-colors"
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400" /> Mode: {activeMode.toUpperCase()}
          </button>
        </div>
      </div>

      {/* 2-Column Grid: Settings & Speech Transcript */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Column 1: Voice Persona Selector */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3 shadow-xl">
          <h3 className="text-sm font-mono text-slate-200 flex items-center gap-2 font-bold">
            <Volume2 className="w-4 h-4 text-cyan-400" /> TTS Voice Persona
          </h3>

          <div className="grid grid-cols-1 gap-2 font-mono text-xs max-h-56 overflow-y-auto pr-1">
            {kokoroVoicesList.map((v) => {
              const isSelected = activeVoice === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => handleVoiceChange(v.id)}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-slate-950 border-cyan-500 text-cyan-300'
                      : 'bg-slate-950/40 border-slate-800/80 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="font-medium text-slate-200">{v.name}</span>
                  {isSelected ? (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <span className="text-[10px] text-slate-500">{v.tag}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Speech Transcript & Quick Actions */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="text-sm font-mono text-slate-200 flex items-center gap-2 font-bold">
              <Terminal className="w-4 h-4 text-purple-400" /> Speech Log & Quick Prompts
            </h3>

            <div className="flex flex-wrap gap-1.5 font-mono text-xs">
              {[
                { cmd: '/calc 1024 * 16', label: '/calc' },
                { cmd: '/hardware', label: '/hardware' },
                { cmd: '/search AI breakthroughs', label: '/search' },
                { cmd: '/mcp', label: '/mcp' }
              ].map((item, idx) => (
                <button
                  key={idx}
                  onClick={() => handleExecuteQuickSkill(item.cmd)}
                  className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-purple-500 text-purple-300 transition-colors"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 font-mono text-xs min-h-[70px] text-cyan-300 whitespace-pre-wrap">
            {lastTranscript || 'Listening for speech input...'}
          </div>
        </div>
      </div>
    </div>
  );
}
