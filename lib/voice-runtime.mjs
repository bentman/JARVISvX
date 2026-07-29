import { VoiceModelBootstrap } from './model-bootstrap.mjs';
import { cleanVoiceTranscript } from './voice-transcript.mjs';

export const localKokoroVoices = ['af_bella', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];
export const localVoiceModes = ['wake', 'ptt', 'conversation'];

export class VoiceRuntime {
  constructor({ database, publish }) { this.database = database; this.publish = publish; this.bootstrap = new VoiceModelBootstrap({ publish }); this.state = 'bootstrap'; this.detail = null; }
  async initialize() {
    this.detail = null;
    for (const modelId of ['wake.hey-jarvis', 'stt.whisper-base-en', 'tts.kokoro-v1']) {
      try { await this.install(modelId); }
      catch (error) { this.detail = `Unable to install ${modelId}: ${error.message}`; this.publish({ type: 'voice-state', state: this.state, detail: this.detail }); }
    }
    return this;
  }
  async status() {
    const runtime = this.database.setting('voice.runtime', null);
    const state = runtime?.state || this.state; const detail = runtime?.detail || this.detail || null; const models = await this.bootstrap.status();
    return {
      state,
      enabled: this.database.setting('voice.enabled', true),
      mode: this.database.setting('voice.mode', 'wake'),
      voice: this.database.setting('voice.kokoro.voice', 'bf_isabella'),
      voices: localKokoroVoices,
      activeSession: this.database.setting('voice.active-session', null),
      tuning: this.database.setting('voice.tuning', null),
      models,
      detail,
      message: detail || this.message(state)
    };
  }
  message(state = this.state) {
    if (state === 'arming') return 'Starting the Electron microphone host.';
    if (state === 'wake-loading') return 'Loading local wake word and speech recognition models.';
    if (state === 'wake-warming') return 'Warming up local wake word detection.';
    if (state === 'wake-listening') return 'Listening locally for “Hey Jarvis”.';
    if (state === 'capturing') return 'Capturing a local voice utterance.';
    if (state === 'transcribing') return 'Transcribing locally with Whisper.';
    if (state === 'thinking') return 'Transcription complete; waiting for the selected model.';
    if (state === 'speaking') return 'Speaking with the selected local Kokoro voice.';
    if (state === 'ready') return 'Voice runtime is ready for the Electron audio host.';
    if (state === 'muted') return 'Voice is muted.';
    if (state === 'unavailable' || state === 'error') return 'Voice is unavailable. Check the detail shown here or in Diagnostics.';
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
      ready: Boolean(model?.ready)
    });
    this.publish({ type: 'voice-state', state: this.state });
    return result;
  }
  setState(state, detail = null) { this.state = state; this.database.setSetting('voice.runtime', { state, detail, updatedAt: new Date().toISOString() }); this.publish({ type: 'voice-state', state, detail }); }
  setEnabled(enabled) { this.database.setSetting('voice.enabled', Boolean(enabled)); this.publish({ type: 'voice-state', state: enabled ? this.state : 'muted', enabled: Boolean(enabled) }); }
  setMode(mode) { if (!localVoiceModes.includes(mode)) throw new Error(`Unsupported local voice mode: ${mode}.`); this.database.setSetting('voice.mode', mode); this.publish({ type: 'voice-state', state: this.state, mode }); }
  setVoice(voice) { if (!localKokoroVoices.includes(voice)) throw new Error(`Voice ${voice} is not installed locally.`); this.database.setSetting('voice.kokoro.voice', voice); this.publish({ type: 'voice-state', state: this.state, voice }); }
  transcript(kind, text, conversationId = null) {
    const cleaned = cleanVoiceTranscript(text);
    if (!['partial', 'final'].includes(kind) || !cleaned) return false;
    const event = { type: `${kind}-transcript`, text: cleaned, conversationId, origin: 'voice' };
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
