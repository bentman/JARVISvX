import { VoiceModelBootstrap } from './model-bootstrap.mjs';

export const localKokoroVoices = ['bf_isabella'];

export class VoiceRuntime {
  constructor({ database, publish }) { this.database = database; this.publish = publish; this.bootstrap = new VoiceModelBootstrap({ publish }); this.state = 'bootstrap'; }
  async status() {
    const runtime = this.database.setting('voice.runtime', null);
    const state = runtime?.state || this.state; const models = await this.bootstrap.status();
    return {
      state,
      enabled: this.database.setting('voice.enabled', true),
      voice: this.database.setting('voice.kokoro.voice', 'bf_isabella'),
      voices: localKokoroVoices,
      activeSession: this.database.setting('voice.active-session', null),
      tuning: this.database.setting('voice.tuning', null),
      models,
      detail: runtime?.detail || null,
      message: runtime?.detail || this.message(state)
    };
  }
  message(state = this.state) {
    if (state === 'wake-listening') return 'Listening locally for “Hey Jarvis”.';
    if (state === 'capturing') return 'Capturing a local voice utterance.';
    if (state === 'transcribing') return 'Transcribing locally with Whisper.';
    if (state === 'thinking') return 'Transcription complete; waiting for the selected model.';
    if (state === 'speaking') return 'Speaking with the selected local Kokoro voice.';
    if (state === 'ready') return 'Voice runtime is ready for the Electron audio host.';
    return 'Voice models are managed locally; microphone capture and ONNX inference remain unavailable until the Electron audio host initializes them.';
  }
  async install(modelId) {
    this.state = 'bootstrap';
    const result = await this.bootstrap.install(modelId);
    const model = (await this.bootstrap.status()).find((item) => item.id === modelId);
    this.database.setSetting(`voice.bootstrap.${modelId}`, {
      installedAt: new Date().toISOString(),
      revision: model?.revision || null,
      source: model?.source || null,
      license: model?.license || null,
      ready: Boolean(model?.ready)
    });
    this.publish({ type: 'voice-state', state: this.state });
    return result;
  }
  setState(state, detail = null) { this.state = state; this.database.setSetting('voice.runtime', { state, detail, updatedAt: new Date().toISOString() }); this.publish({ type: 'voice-state', state, detail }); }
  setEnabled(enabled) { this.database.setSetting('voice.enabled', Boolean(enabled)); this.publish({ type: 'voice-state', state: enabled ? this.state : 'muted', enabled: Boolean(enabled) }); }
  setVoice(voice) { if (!localKokoroVoices.includes(voice)) throw new Error(`Voice ${voice} is not installed locally.`); this.database.setSetting('voice.kokoro.voice', voice); this.publish({ type: 'voice-state', state: this.state, voice }); }
  transcript(kind, text, conversationId = null) {
    if (!['partial', 'final'].includes(kind) || !String(text || '').trim()) return false;
    const event = { type: `${kind}-transcript`, text: String(text).trim(), conversationId, origin: 'voice' };
    this.database.setSetting('voice.active-session', { conversationId, lastTranscriptAt: new Date().toISOString(), state: kind === 'final' ? 'thinking' : 'capturing' });
    this.publish(event);
    return true;
  }
  setSession(conversationId, state) { this.database.setSetting('voice.active-session', { conversationId, state, updatedAt: new Date().toISOString() }); }
  event(event = {}) {
    const supported = new Set(['sentence-ready', 'playback', 'bootstrap-progress', 'benchmark']);
    if (!supported.has(event.type)) return false;
    if (event.type === 'benchmark') { const profile = this.database.setting('voice.tuning', {}); this.database.setSetting('voice.tuning', { ...profile, executionProvider: event.executionProvider || profile.executionProvider || 'wasm', measurements: { ...(profile.measurements || {}), [event.component || 'unknown']: event }, updatedAt: new Date().toISOString() }); }
    this.publish({ ...event, origin: 'voice' });
    return true;
  }
  interrupt(conversationId) { this.publish({ type: 'playback', state: 'interrupted', conversationId }); }
}
