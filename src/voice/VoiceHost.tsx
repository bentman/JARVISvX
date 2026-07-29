import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { VoiceControls } from '../VoiceControls';
import audioProcessorSource from './audio-processor.ts?raw';

type VoiceHostProps = { onTranscript: (text: string) => void; onState: (state: string, detail?: string) => void; onInterrupt: () => void };

export function VoiceHost({ onTranscript, onState, onInterrupt }: VoiceHostProps) {
  const [controlsTarget, setControlsTarget] = useState<Element | null>(null);
  const worker = useRef<Worker | null>(null);
  const transcriptRef = useRef(onTranscript); const stateRef = useRef(onState); const interruptRef = useRef(onInterrupt);
  const playback = useRef(new Set<AudioBufferSourceNode>()); const audioQueue = useRef<{ samples: Float32Array; rate: number }[]>([]);
  const playing = useRef(false); const playbackGeneration = useRef(0); const bargeFrames = useRef(0); const enabled = useRef(true); const speakingConversation = useRef<string | null>(null);
  const voice = useRef('bf_isabella'); const sentence = useRef(''); const synthesis = useRef(0); const synthesisQueue = useRef(Promise.resolve());
  useEffect(() => { transcriptRef.current = onTranscript; stateRef.current = onState; interruptRef.current = onInterrupt; });
  useEffect(() => {
    let stream: MediaStream | undefined; let context: AudioContext | undefined; let source: MediaStreamAudioSourceNode | undefined; let node: AudioWorkletNode | undefined;
    let stopped = false; let started = false;
    const start = async () => {
      if (started || stopped) return;
      const status = await api.voice();
      enabled.current = Boolean(status.enabled);
      voice.current = status.voice || 'bf_isabella';
      if (!status.models.every((model: any) => model.ready)) { stateRef.current('bootstrap', 'Local voice assets are not installed.'); return; }
      try {
        started = true;
        stateRef.current('arming');
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        context = new AudioContext();
        const workletUrl = URL.createObjectURL(new Blob([audioProcessorSource], { type: 'application/javascript' }));
        try { await context.audioWorklet.addModule(workletUrl); } finally { URL.revokeObjectURL(workletUrl); }
        source = context.createMediaStreamSource(stream); node = new AudioWorkletNode(context, 'jarvis-audio-processor');
        worker.current = new Worker(new URL('./wake-worker.ts', import.meta.url), { type: 'module' });
        const stopPlayback = () => { playbackGeneration.current += 1; synthesis.current += 1; sentence.current = ''; audioQueue.current = []; playing.current = false; playback.current.forEach((output) => output.stop()); playback.current.clear(); void window.jarvisDesktop?.tts('cancel').catch(() => {}); void api.voiceEvent({ type: 'playback', state: 'interrupted', conversationId: speakingConversation.current }); };
        const playNext = () => {
          if (!context || playing.current) return;
          const next = audioQueue.current.shift();
          if (!next) { stateRef.current(enabled.current ? 'wake-listening' : 'muted'); void api.voiceEvent({ type: 'playback', state: 'complete', conversationId: speakingConversation.current }); speakingConversation.current = null; return; }
          playing.current = true;
          const buffer = context.createBuffer(1, next.samples.length, next.rate); buffer.copyToChannel(new Float32Array(next.samples), 0);
          const output = context.createBufferSource(); const generation = playbackGeneration.current; output.buffer = buffer; output.connect(context.destination); playback.current.add(output);
          output.onended = () => { if (generation !== playbackGeneration.current) return; playback.current.delete(output); playing.current = false; playNext(); };
          void api.voiceEvent({ type: 'playback', state: 'started', sampleRate: next.rate, conversationId: speakingConversation.current }); output.start();
        };
        const enqueue = (text: string) => { const generation = synthesis.current; synthesisQueue.current = synthesisQueue.current.then(async () => { if (!text.trim() || generation !== synthesis.current) return; try { const output = await window.jarvisDesktop?.tts('synthesize', { text, voice: voice.current }); if (!output || generation !== synthesis.current) return; void api.voiceEvent({ type: 'sentence-ready', text, conversationId: speakingConversation.current }); audioQueue.current.push({ samples: new Float32Array(output.samples), rate: output.sampleRate }); playNext(); } catch (error: any) { if (generation === synthesis.current) stateRef.current('error', `Local Kokoro error: ${error.message}`); } }); };
        const queueSpeech = (token: string, done: boolean) => { sentence.current += token; const parts = sentence.current.split(/(?<=[.!?])\s+/); sentence.current = parts.pop() || ''; parts.forEach(enqueue); if (done && sentence.current.trim()) { enqueue(sentence.current); sentence.current = ''; } };
        worker.current.onmessage = ({ data }) => {
          if (data.type === 'ready') stateRef.current(enabled.current ? 'wake-listening' : 'muted');
          if (data.type === 'wake') { stopPlayback(); worker.current?.postMessage({ type: 'cancel-speech' }); if (speakingConversation.current) void api.cancel(speakingConversation.current); interruptRef.current(); stateRef.current('capturing'); }
          if (data.type === 'transcribing') stateRef.current('transcribing');
          if (data.type === 'partial-transcript' && data.text) void api.voiceTranscript('partial', data.text, speakingConversation.current || undefined);
          if (data.type === 'transcript') { stateRef.current('thinking'); if (data.text) transcriptRef.current(data.text); }
          if (data.type === 'benchmark') void api.voiceEvent(data);
          if (data.type === 'error') stateRef.current('error', data.message);
        };
        node.port.onmessage = ({ data }) => {
          const samples = new Float32Array(data);
          if (playing.current) {
            const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
            bargeFrames.current = rms >= 0.018 ? bargeFrames.current + 1 : 0;
            if (bargeFrames.current >= 3) { bargeFrames.current = 0; stopPlayback(); worker.current?.postMessage({ type: 'capture' }); if (speakingConversation.current) void api.cancel(speakingConversation.current); interruptRef.current(); stateRef.current('capturing'); }
          } else bargeFrames.current = 0;
          worker.current?.postMessage({ type: 'audio', samples }, [samples.buffer]);
        };
        // Deliberately do not connect the microphone worklet to context.destination:
        // monitoring it would create an acoustic feedback path into wake detection.
        source.connect(node);
        const daemon = await window.jarvisDesktop?.daemon();
        const assetBase = daemon ? `http://127.0.0.1:${daemon.port}/api/voice-assets` : `${window.location.origin}/api/voice-assets`;
        worker.current.postMessage({ type: 'init', baseUrl: assetBase, enabled: enabled.current, voice: status.voice });
        const handleSpeak = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail?.type === 'interrupt') { stopPlayback(); worker.current?.postMessage({ type: 'reset' }); return; } worker.current?.postMessage(detail); };
        window.addEventListener('jarvis:speak', handleSpeak);
        const eventController = new AbortController();
        void (async () => {
          try {
            for await (const event of api.events(eventController.signal)) {
              if (event.type === 'voice-state') { if (typeof event.voice === 'string') { stopPlayback(); voice.current = event.voice; } if (typeof event.enabled === 'boolean') { enabled.current = event.enabled; if (!enabled.current) stopPlayback(); worker.current?.postMessage({ type: 'listening', enabled: enabled.current }); } continue; }
              if (!enabled.current) continue;
              if (event.type === 'token') { speakingConversation.current = event.conversationId || null; queueSpeech(event.value, false); continue; }
              if (event.type === 'turn-complete') { if (!event.conversationId || event.conversationId === speakingConversation.current) queueSpeech('', true); continue; }
              if ((event.type === 'cancelled' || event.type === 'error') && (!event.conversationId || event.conversationId === speakingConversation.current)) { stopPlayback(); worker.current?.postMessage({ type: 'interrupt' }); speakingConversation.current = null; }
            }
          } catch (error: any) { if (!eventController.signal.aborted) stateRef.current('unavailable', `Voice event stream ended: ${error.message}`); }
        })();
        return () => { eventController.abort(); window.removeEventListener('jarvis:speak', handleSpeak); };
      } catch (error: any) { if (!stopped) stateRef.current('unavailable', error.message); }
    };
    let removeRuntime: (() => void) | undefined;
    const retry = () => { void start().then((cleanup) => { removeRuntime = cleanup; }); };
    window.addEventListener('jarvis:voice-assets-ready', retry); retry();
    return () => { stopped = true; window.removeEventListener('jarvis:voice-assets-ready', retry); removeRuntime?.(); audioQueue.current = []; playback.current.forEach((output) => output.stop()); worker.current?.terminate(); node?.disconnect(); source?.disconnect(); void context?.close(); stream?.getTracks().forEach((track) => track.stop()); };
  }, []);
  useEffect(() => { setControlsTarget(document.querySelector('.model-controls')); }, []);
  return controlsTarget ? createPortal(<VoiceControls />, controlsTarget) : null;
}
