import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { subscribeEvents } from '../events';
import { publishAudioLevel } from './audio-level';
import { VoiceControls } from '../VoiceControls';
import audioProcessorSource from './audio-processor.ts?raw';

type VoiceHostProps = { onTranscript: (text: string) => void; onState: (state: string, detail?: string) => void; onInterrupt: () => void };

export function VoiceHost({ onTranscript, onState, onInterrupt }: VoiceHostProps) {
  const [controlsTarget, setControlsTarget] = useState<Element | null>(null);
  const worker = useRef<Worker | null>(null);
  const transcriptRef = useRef(onTranscript); const stateRef = useRef(onState); const interruptRef = useRef(onInterrupt);
  const playback = useRef(new Set<AudioBufferSourceNode>()); const audioQueue = useRef<{ samples: Float32Array; rate: number }[]>([]);
  const playing = useRef(false); const playbackGeneration = useRef(0); const bargeFrames = useRef(0); const enabled = useRef(true); const speakingConversation = useRef<string | null>(null); const speakingTurn = useRef<string | null>(null);
  const mode = useRef('wake'); const voice = useRef('bf_isabella'); const sentence = useRef(''); const synthesis = useRef(0); const synthesisQueue = useRef(Promise.resolve()); const synthesisPending = useRef(0); const voiceTurnActive = useRef(false);
  const idleState = () => enabled.current ? mode.current === 'wake' ? 'wake-listening' : mode.current === 'conversation' ? 'capturing' : 'ready' : 'muted';
  useEffect(() => { transcriptRef.current = onTranscript; stateRef.current = onState; interruptRef.current = onInterrupt; });
  useEffect(() => {
    let stream: MediaStream | undefined; let context: AudioContext | undefined; let source: MediaStreamAudioSourceNode | undefined; let node: AudioWorkletNode | undefined; let monitor: GainNode | undefined; let returnTimer: number | undefined;
    let stopped = false; let started = false;
    const start = async () => {
      if (started || stopped) return;
      const status = await api.voice();
      enabled.current = Boolean(status.enabled);
      mode.current = 'wake';
      voice.current = status.voice || 'bf_isabella';
      const missing = (status.models || []).filter((model: any) => !model.ready && !model.optional);
      if (missing.length) { stateRef.current('bootstrap', `Missing local voice assets: ${missing.map((model: any) => model.id).join(', ')}. Connect to the network and use Install voice assets.`); return; }
      try {
        started = true;
        stateRef.current('arming');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this browser context. Start the Electron desktop app to use wake mode.');
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (error: any) {
          const reason = error?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : error?.name === 'NotFoundError' ? 'No microphone input device was found.' : error?.message || String(error);
          throw new Error(`Wake mode cannot start microphone capture: ${reason}`);
        }
        context = new AudioContext();
        const workletUrl = URL.createObjectURL(new Blob([audioProcessorSource], { type: 'application/javascript' }));
        try { await context.audioWorklet.addModule(workletUrl); } finally { URL.revokeObjectURL(workletUrl); }
        source = context.createMediaStreamSource(stream); node = new AudioWorkletNode(context, 'jarvis-audio-processor'); monitor = context.createGain(); monitor.gain.value = 0;
        worker.current = new Worker(new URL('./wake-worker.ts', import.meta.url), { type: 'module' });
        const clearReturnTimer = () => { if (returnTimer) window.clearTimeout(returnTimer); returnTimer = undefined; };
        const workerListening = () => enabled.current && !voiceTurnActive.current;
        const pauseVoiceInput = () => { clearReturnTimer(); voiceTurnActive.current = true; worker.current?.postMessage({ type: 'listening', enabled: false }); };
        const resumeVoiceInput = (detail?: string) => {
          clearReturnTimer();
          voiceTurnActive.current = false;
          worker.current?.postMessage({ type: 'listening', enabled: enabled.current });
          const next = idleState();
          if (!enabled.current) { stateRef.current(next, detail); return; }
          stateRef.current('returning-to-listen', detail || 'Returning to local listening.');
          returnTimer = window.setTimeout(() => { returnTimer = undefined; stateRef.current(idleState(), detail); }, 150);
        };
        const shouldCancelTts = () => playing.current || audioQueue.current.length > 0 || sentence.current.trim().length > 0 || voiceTurnActive.current || Boolean(speakingConversation.current);
        const resetSpeechOutput = (cancelTts = shouldCancelTts()) => {
          playbackGeneration.current += 1;
          synthesis.current += 1;
          synthesisPending.current = 0;
          sentence.current = '';
          audioQueue.current = [];
          playing.current = false;
          playback.current.forEach((output) => { try { output.stop(); } catch {} });
          playback.current.clear();
          if (cancelTts) void window.jarvisDesktop?.tts('cancel').catch(() => {});
        };
        const stopPlayback = (detail = 'Speech output interrupted.', recover = true) => {
          const conversationId = speakingConversation.current;
          const turnId = speakingTurn.current;
          const cancelTts = shouldCancelTts();
          resetSpeechOutput(cancelTts);
          speakingConversation.current = null;
          speakingTurn.current = null;
          if (recover) resumeVoiceInput(detail);
          if (cancelTts || conversationId) void api.voiceEvent({ type: 'playback', state: 'interrupted', detail, conversationId, turnId });
          return { conversationId, turnId };
        };
        const playNext = async () => {
          if (!context || playing.current) return;
          const next = audioQueue.current.shift();
          if (!next && synthesisPending.current > 0) { window.setTimeout(() => void playNext(), 120); return; }
          if (!next) { const conversationId = speakingConversation.current; const turnId = speakingTurn.current; speakingConversation.current = null; speakingTurn.current = null; resumeVoiceInput('Speech playback complete.'); void api.voiceEvent({ type: 'playback', state: 'complete', conversationId, turnId }); return; }
          try {
            playing.current = true;
            if (context.state !== 'running') {
              stateRef.current('speaking', `Resuming Electron audio output (${context.state}).`);
              await context.resume();
            }
            if (context.state !== 'running') throw new Error(`Electron audio output is ${context.state}; click the app window or check OS audio output, then try again.`);
            const buffer = context.createBuffer(1, next.samples.length, next.rate); buffer.copyToChannel(new Float32Array(next.samples), 0);
            const output = context.createBufferSource(); const generation = playbackGeneration.current; output.buffer = buffer; output.connect(context.destination); playback.current.add(output);
            output.onended = () => { if (generation !== playbackGeneration.current) return; playback.current.delete(output); playing.current = false; void playNext(); };
            void api.voiceEvent({ type: 'playback', state: 'started', sampleRate: next.rate, conversationId: speakingConversation.current, turnId: speakingTurn.current }); output.start();
          } catch (error: any) {
            const message = `Local audio playback error: ${error.message || String(error)}`;
            const conversationId = speakingConversation.current;
            const turnId = speakingTurn.current;
            resetSpeechOutput(false);
            speakingConversation.current = null;
            speakingTurn.current = null;
            resumeVoiceInput(message);
            void api.voiceEvent({ type: 'playback', state: 'error', detail: message, conversationId, turnId });
          }
        };
        const speakableText = (text: string) => text
          .replace(/```[\s\S]*?```/g, ' ')
          .replace(/`([^`]*)`/g, '$1')
          .replace(/\[(.*?)\]\(.*?\)/g, '$1')
          .replace(/^\s{0,3}[-*+]\s+/gm, '')
          .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
          .replace(/#{1,6}\s*/g, '')
          .replace(/[*_~>|[\]{}]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const toFloatSamples = (samples: unknown) => samples instanceof Float32Array ? samples : samples instanceof ArrayBuffer ? new Float32Array(samples) : ArrayBuffer.isView(samples) ? new Float32Array(samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength)) : Array.isArray(samples) ? Float32Array.from(samples) : new Float32Array();
        const waitForPlaybackRoom = (generation: number) => new Promise<void>((resolve) => {
          const check = () => generation !== synthesis.current || audioQueue.current.length < 2 ? resolve() : window.setTimeout(check, 200);
          check();
        });
        const waitForTts = (request: Promise<any>) => new Promise<any>((resolve, reject) => {
          const timer = window.setTimeout(() => reject(new Error('Local Kokoro IPC did not resolve within 95s. Check the last TTS stage shown in the voice status.')), 95_000);
          request.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
        });
        const enqueue = (text: string) => { const generation = synthesis.current; const spoken = speakableText(text); if (!spoken) return; synthesisPending.current += 1; synthesisQueue.current = synthesisQueue.current.then(async () => { if (generation !== synthesis.current) return; try { await waitForPlaybackRoom(generation); if (generation !== synthesis.current) return; const startedAt = performance.now(); stateRef.current('speaking', `Loading/synthesizing Kokoro v1.0 speech (${Math.min(spoken.length, 80)} chars).`); if (!window.jarvisDesktop?.tts) throw new Error('Electron TTS bridge is unavailable. Restart the desktop app.'); const output = await waitForTts(window.jarvisDesktop.tts('synthesize', { text: spoken, voice: voice.current })); if (generation !== synthesis.current) return; if (output?.cancelled) { resetSpeechOutput(false); speakingConversation.current = null; speakingTurn.current = null; resumeVoiceInput('Local Kokoro synthesis was cancelled.'); return; } if (output?.ok === false) throw new Error(`${output.stage ? `${output.stage}: ` : ''}${output.error || 'Local Kokoro synthesis failed.'}`); const samples = toFloatSamples(output?.samples); const sampleRate = Number(output?.sampleRate || 24_000); if (!samples.length) throw new Error('Local Kokoro returned no audio samples.'); const seconds = samples.length / sampleRate; stateRef.current('speaking', `Kokoro generated ${seconds.toFixed(1)}s of audio in ${((performance.now() - startedAt) / 1000).toFixed(1)}s; starting playback.`); void api.voiceEvent({ type: 'sentence-ready', text: spoken, sampleCount: samples.length, sampleRate, conversationId: speakingConversation.current, turnId: speakingTurn.current }); audioQueue.current.push({ samples, rate: sampleRate }); void playNext(); } catch (error: any) { if (generation === synthesis.current) { const conversationId = speakingConversation.current; const turnId = speakingTurn.current; const message = `Local Kokoro error: ${error.message}`; resetSpeechOutput(false); speakingConversation.current = null; speakingTurn.current = null; resumeVoiceInput(message); void api.voiceEvent({ type: 'playback', state: 'error', detail: message, conversationId, turnId }); } } finally { synthesisPending.current = Math.max(0, synthesisPending.current - 1); } }); };
        const flushSpeechParts = () => { const parts = sentence.current.split(/(?<=[.!?])\s+|(?<=:)\s+|\n+/); sentence.current = parts.pop() || ''; parts.forEach(enqueue); if (sentence.current.length >= 90) { const chunk = sentence.current.slice(0, sentence.current.lastIndexOf(' ', 90) > 40 ? sentence.current.lastIndexOf(' ', 90) : 90); sentence.current = sentence.current.slice(chunk.length).trimStart(); enqueue(chunk); } };
        const queueSpeech = (token: string, done: boolean) => { sentence.current += token; flushSpeechParts(); if (done && sentence.current.trim()) { enqueue(sentence.current); sentence.current = ''; } if (done) void synthesisQueue.current.then(() => { if (!playing.current && !audioQueue.current.length && !sentence.current.trim() && !synthesisPending.current) { speakingConversation.current = null; speakingTurn.current = null; resumeVoiceInput('Assistant turn complete; no local speech is queued.'); } }); };
        worker.current.onerror = (error) => { console.error('[wake-worker]', error); stateRef.current('error', `Wake worker failed: ${error.message}`); };
        worker.current.onmessage = ({ data }) => {
          if (data.type === 'loading') stateRef.current('wake-loading', data.message);
          if (data.type === 'ready') stateRef.current(enabled.current ? mode.current === 'wake' ? 'wake-warming' : mode.current === 'conversation' ? 'capturing' : 'ready' : 'muted');
          if (data.type === 'wake-ready') stateRef.current(enabled.current ? 'wake-listening' : 'muted');
          if (data.type === 'wake') { const stoppedTurn = stopPlayback('Wake word interrupted speech output.', false); if (stoppedTurn.conversationId) { void api.cancel(stoppedTurn.conversationId, stoppedTurn.turnId || undefined); interruptRef.current(); } stateRef.current('capturing'); }
          if (data.type === 'transcribing') stateRef.current('transcribing');
          if (data.type === 'partial-transcript' && data.text && mode.current === 'conversation') void api.voiceTranscript('partial', data.text, speakingConversation.current || undefined);
          if (data.type === 'transcript') { if (data.text) { pauseVoiceInput(); stateRef.current('thinking'); transcriptRef.current(data.text); } else resumeVoiceInput(data.rawText ? `Speech recognition returned ${data.rawText}.` : 'No speech was captured after the wake word.'); }
          if (data.type === 'benchmark') void api.voiceEvent(data);
          if (data.type === 'error') { console.error('[wake-worker]', data.message); stateRef.current('error', data.message); }
        };
        node.port.onmessage = ({ data }) => {
          const samples = new Float32Array(data);
          const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
          publishAudioLevel(rms);
          if (playing.current) {
            bargeFrames.current = rms >= 0.045 ? bargeFrames.current + 1 : 0;
            if (bargeFrames.current >= 8) { bargeFrames.current = 0; const stoppedTurn = stopPlayback('Speech output interrupted by microphone input.', false); worker.current?.postMessage({ type: 'capture' }); if (stoppedTurn.conversationId) void api.cancel(stoppedTurn.conversationId, stoppedTurn.turnId || undefined); interruptRef.current(); stateRef.current('capturing'); }
          } else bargeFrames.current = 0;
          worker.current?.postMessage({ type: 'audio', samples }, [samples.buffer]);
        };
        // A zero-gain sink keeps Chromium pulling the worklet without monitoring mic audio.
        source.connect(node).connect(monitor).connect(context.destination);
        const assetBase = await api.voiceAssetBase();
        worker.current.postMessage({ type: 'init', baseUrl: assetBase, enabled: workerListening(), mode: mode.current, voice: status.voice });
        const handleSpeak = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (detail?.type === 'interrupt') { stopPlayback('Speech output interrupted.'); worker.current?.postMessage({ type: 'reset' }); return; }
          if (detail?.type === 'assistant-token') { const nextConversation = detail.conversationId || speakingConversation.current; if (nextConversation && speakingConversation.current && nextConversation !== speakingConversation.current) stopPlayback('New assistant speech interrupted the previous output.'); if (!voiceTurnActive.current) pauseVoiceInput(); speakingConversation.current = nextConversation; speakingTurn.current = detail.turnId || speakingTurn.current; stateRef.current('speaking', 'Assistant output queued for local speech.'); queueSpeech(String(detail.value || ''), false); return; }
          if (detail?.type === 'assistant-complete') { speakingConversation.current = detail.conversationId || speakingConversation.current; speakingTurn.current = detail.turnId || speakingTurn.current; queueSpeech('', true); return; }
          if (detail?.type === 'assistant-error') { stopPlayback('Assistant turn ended before speech playback completed.'); worker.current?.postMessage({ type: 'interrupt' }); return; }
          worker.current?.postMessage(detail);
        };
        window.addEventListener('jarvis:speak', handleSpeak);
        const removeTtsProgress = window.jarvisDesktop?.onTtsProgress?.((event) => { if (event?.message && voiceTurnActive.current) stateRef.current('speaking', event.message); });
        const stopEvents = subscribeEvents((event) => {
              if (event.type === 'voice-state') { if (typeof event.voice === 'string') { stopPlayback('Voice changed; speech output reset.'); voice.current = event.voice; } if (typeof event.mode === 'string') { mode.current = event.mode; stopPlayback('Voice mode changed; input loop reset.'); worker.current?.postMessage({ type: 'mode', mode: mode.current }); } if (typeof event.enabled === 'boolean') { enabled.current = event.enabled; if (!enabled.current) stopPlayback('Voice muted.'); worker.current?.postMessage({ type: 'listening', enabled: workerListening() }); if (enabled.current) resumeVoiceInput('Voice unmuted.'); } return; }
              if (!enabled.current) return;
              if (event.type === 'token') return;
              if (event.type === 'turn-complete') return;
              if ((event.type === 'cancelled' || event.type === 'error') && (!event.conversationId || event.conversationId === speakingConversation.current) && (!event.turnId || event.turnId === speakingTurn.current)) { stopPlayback(event.type === 'cancelled' ? 'Assistant turn cancelled.' : `Assistant turn error: ${event.message || 'Unknown error.'}`); worker.current?.postMessage({ type: 'interrupt' }); }
        }, (message) => stateRef.current('unavailable', `Voice event stream ended: ${message}`));
        return () => { clearReturnTimer(); stopEvents(); removeTtsProgress?.(); window.removeEventListener('jarvis:speak', handleSpeak); };
      } catch (error: any) { if (!stopped) stateRef.current('unavailable', error.message); }
    };
    let removeRuntime: (() => void) | undefined;
    const retry = () => { void start().then((cleanup) => { removeRuntime = cleanup; }); };
    window.addEventListener('jarvis:voice-assets-ready', retry); retry();
    return () => { stopped = true; if (returnTimer) window.clearTimeout(returnTimer); window.removeEventListener('jarvis:voice-assets-ready', retry); removeRuntime?.(); audioQueue.current = []; playback.current.forEach((output) => output.stop()); worker.current?.terminate(); monitor?.disconnect(); node?.disconnect(); source?.disconnect(); void context?.close(); stream?.getTracks().forEach((track) => track.stop()); };
  }, []);
  useEffect(() => { setControlsTarget(document.querySelector('.model-controls')); }, []);
  return controlsTarget ? createPortal(<VoiceControls />, controlsTarget) : null;
}

