import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useDaemonEvents } from '../events';
import { currentAudioLevel } from '../voice/audio-level';
import { useVoiceStatus } from '../hooks/useVoiceStatus';
import { VoiceOrb } from './VoiceOrb';
import {
  Mic,
  Square,
  Volume2,
  Radio,
  Terminal,
  Activity,
  CheckCircle2,
  X
} from 'lucide-react';
import { PanelCard } from './ui/PanelCard';
import { PanelHeader } from './ui/PanelHeader';
import { SectionDivider } from './ui/SectionDivider';
import { StatusBadge } from './ui/StatusBadge';

type SpeechLogEntry = { id: string; at: string; text: string };
const VOICE_LABELS: Record<string, { name: string; tag: string }> = {
  bf_isabella: { name: 'Isabella (British Soft)', tag: 'Recommended' },
  af_sarah: { name: 'Sarah (American Crisp)', tag: 'Popular' },
  af_bella: { name: 'Bella (American Expressive)', tag: 'Warm' },
  am_adam: { name: 'Adam (American Deep)', tag: 'Male' },
  am_michael: { name: 'Michael (American Clear)', tag: 'Male' },
  bf_emma: { name: 'Emma (British Formal)', tag: 'British' },
  bm_george: { name: 'George (British Deep)', tag: 'Male' },
  bm_lewis: { name: 'Lewis (British Clear)', tag: 'Male' },
};

const MAX_SPEECH_LOG_ENTRIES = 100;

export function VoiceHudView() {
  const { voice: voiceStatus, refresh: refreshStatus, error: voiceError } = useVoiceStatus();
  const [activeVoice, setActiveVoice] = useState('bf_isabella');
  const [activeMode, setActiveMode] = useState('wake');
  const [currentState, setCurrentState] = useState('wake-listening');
  const [audioLevel, setAudioLevel] = useState(0);
  const [speechLog, setSpeechLog] = useState<SpeechLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const animFrameRef = useRef<number | null>(null);
  const speechLogEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (voiceStatus?.voice) setActiveVoice(voiceStatus.voice);
    if (voiceStatus?.mode) setActiveMode(voiceStatus.mode);
    if (voiceStatus?.state) setCurrentState(voiceStatus.state);
  }, [voiceStatus]);

  useEffect(() => {
    if (voiceError) setError(voiceError);
  }, [voiceError]);

  // The speech log accumulates voice-state transitions and final transcript events.
  useDaemonEvents((event) => {
    if (event.type === 'voice-state') {
      const text = event.detail || event.message;
      if (!text) return;
      setSpeechLog((prev) => [...prev, { id: event.id, at: event.at, text }].slice(-MAX_SPEECH_LOG_ENTRIES));
    } else if (event.type === 'final-transcript') {
      setSpeechLog((prev) => [...prev, { id: event.id, at: event.at, text: `Heard: "${event.text}"` }].slice(-MAX_SPEECH_LOG_ENTRIES));
    }
  }, (message) => setError(message));

  useEffect(() => {
    speechLogEndRef.current?.scrollIntoView({ block: 'end' });
  }, [speechLog]);

  // The level meter samples the stream VoiceHost already owns.
  useEffect(() => {
    const tick = () => {
      setAudioLevel(currentAudioLevel());
      animFrameRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
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

  // Capture and interrupt are commands to the capture owner; the state shown
  // afterwards is the one the daemon broadcasts, not one assumed here.
  const commandVoiceHost = (detail: Record<string, unknown>) => window.dispatchEvent(new CustomEvent('jarvis:speak', { detail }));

  const handlePushToTalk = async () => {
    try {
      commandVoiceHost({ type: 'capture' });
      await api.setVoiceState('capturing');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleInterrupt = async () => {
    try {
      commandVoiceHost({ type: 'interrupt' });
      await api.voiceEvent({ type: 'interrupt' });
      await api.setVoiceState('wake-listening', 'Interrupted from the voice HUD.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Which voices exist comes from the runtime; only their presentation is local,
  // and an unlabelled voice still lists under its own identifier.
  const kokoroVoicesList = (voiceStatus?.voices || []).map((id) => ({ id, ...(VOICE_LABELS[id] || { name: id, tag: 'Installed' }) }));

  return (
    <div className="panel-surface panel-content">
      {/* Header */}
      <PanelHeader
        icon={<Radio className="w-5 h-5 text-cyan-400" />}
        title="Voice Control Center"
        subtitle="JARVIS Speech Intelligence Runtime"
        actions={
          <StatusBadge status="info">
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
            <span className="badge-icon font-mono uppercase">{currentState}</span>
          </StatusBadge>
        }
      />

      {error && (
        <PanelCard padding="compact" className="text-danger bg-danger-subtle border border-rose">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-mono">{error}</span>
            <button onClick={() => setError(null)} className="btn-icon btn-sm btn-rose">
              <X className="w-3 h-3" />
            </button>
          </div>
        </PanelCard>
      )}

      {/* Hero Presence Card */}
      <PanelCard hover={false} className="voice-presence-card">
        <div className="voice-presence-layout">
          <VoiceOrb
            state={currentState}
            audioLevel={audioLevel}
            onOrbClick={handlePushToTalk}
            size={64}
          />

          <div className="voice-presence-copy">
            <p className="text-small text-secondary font-mono">
              {voiceStatus?.message || 'Listening locally for "Hey Jarvis"...'}
            </p>
          </div>

          <div className="voice-presence-actions">
            <button
              onClick={handlePushToTalk}
              className="btn btn-primary btn-sm"
            >
              <Mic className="w-3.5 h-3.5" /> Push-To-Talk
            </button>

            <button
              onClick={handleInterrupt}
              className="btn btn-sm btn-rose"
            >
              <Square className="w-3.5 h-3.5" /> Interrupt Speech
            </button>

            <button
              onClick={() => handleModeChange(activeMode === 'wake' ? 'ptt' : 'wake')}
              className="btn btn-sm btn-secondary"
            >
              <Radio className="w-3.5 h-3.5 text-cyan-400" /> Mode: {activeMode.toUpperCase()}
            </button>
          </div>
        </div>
      </PanelCard>

      {/* 2-Column Grid: Settings & Speech Transcript */}
      <div className="panel-grid two voice-hud-grid">
        {/* Column 1: Voice Persona Selector */}
        <PanelCard className="voice-persona-card">
          <SectionDivider
            title="TTS Voice Persona"
            icon={<Volume2 className="w-4 h-4 text-cyan-400" />}
          />

          <div className="grid grid-cols-1 gap-2 font-mono text-xs voice-list">
            {kokoroVoicesList.map((v) => {
              const isSelected = activeVoice === v.id;
              return (
                <div
                  key={v.id}
                  onClick={() => handleVoiceChange(v.id)}
                  className={`voice-list-row rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'border-cyan-500 text-cyan-300'
                      : 'border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                  style={
                    isSelected
                      ? { backgroundColor: '#0a1825' }
                      : { backgroundColor: '#06111a' }
                  }
                >
                  <span className={`font-medium text-xs ${isSelected ? 'text-cyan-300' : 'text-slate-200'}`}>{v.name}</span>
                  {isSelected ? (
                    <CheckCircle2 className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <span className="text-xs text-slate-400">{v.tag}</span>
                  )}
                </div>
              );
            })}
          </div>
        </PanelCard>

        {/* Column 2: Speech Transcript Log */}
        <PanelCard>
          <SectionDivider
            title="Speech Log"
            icon={<Terminal className="w-4 h-4 text-purple-400" />}
          />

          <div
            className="bg-deep border border-slate-800 rounded-xl p-3 font-mono text-xs text-cyan-300 space-y-2 overflow-y-auto"
            style={{ minHeight: '320px', maxHeight: '320px' }}
          >
            {speechLog.length ? (
              speechLog.map((entry) => (
                <p key={entry.id} className="whitespace-pre-wrap">
                  <span className="text-slate-500">{new Date(entry.at).toLocaleTimeString()}</span>{' '}
                  {entry.text}
                </p>
              ))
            ) : (
              <p className="text-slate-500">Listening for speech input...</p>
            )}
            <div ref={speechLogEndRef} />
          </div>
        </PanelCard>
      </div>
    </div>
  );
}
