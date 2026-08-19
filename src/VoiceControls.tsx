import { Mic, MicOff, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { api } from './api';
import { useVoiceStatus } from './hooks/useVoiceStatus';
import './voice-diagnostics.css';

export function VoiceControls() {
  // Shared bootstrap-fetch + SSE hook (see src/hooks/useVoiceStatus.ts) — replaces the
  // old component-local 1s poll of GET /api/voice.
  const { voice, refresh, error } = useVoiceStatus(); const [busy, setBusy] = useState(false);
  const ready = voice?.models?.every((item: any) => item.ready);
  const missing = voice?.models?.filter((item: any) => !item.ready) || [];
  const problem = ['bootstrap', 'error', 'unavailable'].includes(voice?.state || '') || Boolean(error);
  const update = async (action: () => Promise<unknown>) => { setBusy(true); try { await action(); await refresh(); } finally { setBusy(false); } };
  const bootstrapMissing = () => update(async () => { for (const model of missing) await api.bootstrapVoice(model.id); });
  const testVoice = () => { window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'assistant-token', value: 'Voice test.', conversationId: 'diagnostic-voice-test' } })); window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'assistant-complete', conversationId: 'diagnostic-voice-test' } })); };
  return <div className="header-voice-controls">
    <label className="provider-picker">Voice mode<select value={voice?.mode || 'wake'} disabled={busy || !ready} onChange={(event) => void update(() => api.setVoiceMode(event.target.value))}><option value="wake">Wake</option><option value="ptt">Push to talk</option><option value="conversation">Conversation</option></select></label>
    <label className="provider-picker">Voice<select value={voice?.voice || 'bf_isabella'} disabled={busy || !ready} onChange={(event) => void update(() => api.setVoice(event.target.value))}>{(voice?.voices || ['bf_isabella']).map((item: string) => <option key={item} value={item}>{item}</option>)}</select></label>
    <button className="voice-mute" disabled={busy || !ready} onClick={() => void update(() => api.setListening(!voice?.enabled))}>{voice?.enabled ? <><MicOff /> Mute</> : <><Mic /> Unmute</>}</button>
    <button className="voice-mute" disabled={busy || !ready} onClick={testVoice} title="Play a local Kokoro test phrase"><Volume2 /> Test</button>
    {missing.length ? <button className="voice-bootstrap" disabled={busy} onClick={() => void bootstrapMissing()}>Install voice assets</button> : null}
    <div className={`voice-status ${problem ? 'voice-status-problem' : ''}`} title={voice?.detail || voice?.message || error || ''}><b>{error ? 'error' : (voice?.state || 'loading')}</b><span>{voice?.detail || voice?.message || error || 'Checking local voice runtime...'}</span></div>
  </div>;
}

export function VoiceDiagnostics() {
  const { voice, error } = useVoiceStatus();
  return <section className="voice-diagnostics"><h3>Voice</h3>{error ? <p className="muted">{error}</p> : <><div className="voice-models">{voice?.models?.map((model: any) => <div className="voice-model" key={model.id}><span className={model.ready ? 'online-dot' : 'offline-dot'} /><div><b>{model.family}</b><small>{model.ready ? `models\\${model.directory}` : 'Not installed'}</small></div></div>) || <p className="muted">Loading local voice assets…</p>}</div><p className="muted">Mode: {voice?.mode || 'wake'} · State: {voice?.state || 'loading'}</p>{voice?.tuning?.measurements ? <p className="muted">Wake: {voice.tuning.measurements.wake?.executionProvider || 'unknown'} · STT: {voice.tuning.measurements.stt?.inferenceMs || 'n/a'} ms</p> : null}</>}</section>;
}

