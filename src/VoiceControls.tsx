import { Mic, MicOff, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from './api';

export function VoiceControls() {
  const [voice, setVoice] = useState<any>(null); const [busy, setBusy] = useState(false);
  const refresh = async () => { try { setVoice(await api.voice()); } catch (error: any) { setVoice({ error: error.message }); } };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 1000); return () => window.clearInterval(timer); }, []);
  const enable = async (value: boolean) => { setBusy(true); try { await api.setListening(value); await refresh(); } finally { setBusy(false); } };
  const install = async () => { setBusy(true); try { for (const model of voice?.models?.filter((item: any) => !item.ready) || []) await api.bootstrapVoice(model.id); await refresh(); window.dispatchEvent(new Event('jarvis:voice-assets-ready')); } finally { setBusy(false); } };
  const ready = voice?.models?.every((item: any) => item.ready);
  const chooseVoice = async (value: string) => { setBusy(true); try { await api.setVoice(value); await refresh(); } finally { setBusy(false); } };
  return <section className="voice-console"><p className="eyebrow">VOICE PRESENCE</p><h2>{voice?.state === 'wake-listening' ? 'Listening locally.' : ready ? 'Voice models installed.' : 'Voice bootstrap required.'}</h2><p className="muted">{voice?.message || voice?.error || 'Checking local voice runtime…'}</p><div className="voice-controls"><button disabled={busy || !ready || voice?.state !== 'wake-listening'} onClick={() => enable(!voice?.enabled)}>{voice?.enabled ? <MicOff /> : <Mic />} {voice?.enabled ? 'Mute listening' : 'Enable listening'}</button>{!ready && <button disabled={busy} onClick={install}><Volume2 /> {busy ? 'Downloading local models…' : 'Download local voice models'}</button>}<label>Voice <select value={voice?.voice || 'bf_isabella'} disabled={busy || !ready} onChange={(event) => void chooseVoice(event.target.value)}>{(voice?.voices || ['bf_isabella']).map((item: string) => <option key={item} value={item}>{item}</option>)}</select></label></div>{voice?.models && <small>{voice.models.map((model: any) => `${model.family} (${model.license}, ${model.revision}): ${model.ready ? 'verified' : 'not installed'}`).join(' · ')}</small>}</section>;
}
