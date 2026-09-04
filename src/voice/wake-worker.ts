import * as ort from 'onnxruntime-web';
import { env, pipeline } from '@huggingface/transformers';

type Model = { run: (feeds: Record<string, ort.Tensor>) => Promise<Record<string, ort.Tensor>>; inputNames: string[]; outputNames: string[] };
let mel: Model; let embedding: Model; let wake: Model;
let vad: Model | null = null; let vadState = new Float32Array(2 * 1 * 128); let vadContext = new Float32Array(64); let vadReady = false;
let transcriber: any;
let transcriberPromise: Promise<any> | null = null;
let features: Float32Array[] = []; let active = false; let silenceFrames = 0; let commandVoicedFrames = 0; let partialSamples = 0;
let wakeReady = false; let initialized = false; let processingFrames = false;
let executionProvider = 'wasm'; let benchmarkedWake = false; let listening = true; let mode = 'wake';
const threshold = 0.5;
const frameSamples = 1280;
const vadSamples = 512;
const preRollSamples = 48_000;
const wakeCommandPreRollSamples = 3_200;
const sampleRate = 16_000;
// Queued audio is capped at one second. Beyond that the oldest frames are the
// least useful, so they are dropped and counted rather than growing latency.
const maxQueuedSamples = sampleRate;
const maxQueuedFrames = Math.ceil(maxQueuedSamples / frameSamples);
// The wake window is fixed, so it is written in place rather than rebuilt.
const wakeWindowSamples = 12_600;

/** A fixed-capacity queue of frames; the oldest is discarded when it is full. */
class FrameQueue {
  private frames: Float32Array[] = [];
  dropped = 0;
  push(frame: Float32Array) {
    if (this.frames.length >= maxQueuedFrames) { this.frames.shift(); this.dropped += 1; }
    this.frames.push(frame);
  }
  shift() { return this.frames.shift(); }
  get length() { return this.frames.length; }
  clear() { this.frames = []; }
}

/** A ring of samples with a fixed span, written without reallocating. */
class SampleRing {
  private buffer: Float32Array;
  private written = 0;
  constructor(readonly capacity: number) { this.buffer = new Float32Array(capacity); }
  write(frame: Float32Array) {
    const offset = this.written % this.capacity;
    const head = Math.min(frame.length, this.capacity - offset);
    this.buffer.set(frame.subarray(0, head), offset);
    if (head < frame.length) this.buffer.set(frame.subarray(head), 0);
    this.written += frame.length;
  }
  get filled() { return Math.min(this.written, this.capacity); }
  /** The most recent `count` samples in order. */
  read(count = this.filled) {
    const take = Math.min(count, this.filled);
    const out = new Float32Array(take);
    const start = (this.written - take) % this.capacity;
    const head = Math.min(take, this.capacity - start);
    out.set(this.buffer.subarray(start, start + head), 0);
    if (head < take) out.set(this.buffer.subarray(0, take - head), head);
    return out;
  }
  clear() { this.written = 0; }
}

/** Growing capture of one utterance, doubling instead of spreading per frame. */
class SampleBuffer {
  private buffer = new Float32Array(sampleRate * 8);
  length = 0;
  write(frame: Float32Array) {
    if (this.length + frame.length > this.buffer.length) {
      const grown = new Float32Array(Math.max(this.buffer.length * 2, this.length + frame.length));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(frame, this.length);
    this.length += frame.length;
  }
  read() { return this.buffer.slice(0, this.length); }
  clear() { this.length = 0; }
}

const pendingFrames = new FrameQueue();
const preRoll = new SampleRing(preRollSamples);
const wakeWindow = new SampleRing(wakeWindowSamples);
const utterance = new SampleBuffer();

self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === 'init') { listening = data.enabled !== false; mode = data.mode || 'wake'; return await initialize(data.baseUrl); }
    if (data.type === 'listening') { listening = Boolean(data.enabled); if (!listening) resetCapture(); return; }
    if (data.type === 'mode') { mode = data.mode || 'wake'; resetCapture(); active = mode === 'conversation' && listening; return; }
    if (data.type === 'audio') { pendingFrames.push(new Float32Array(data.samples)); void drainFrames().catch((error) => postMessage({ type: 'error', message: error.message || String(error) })); return; }
    if (data.type === 'reset' || data.type === 'interrupt') { resetCapture(); pendingFrames.clear(); }
    if (data.type === 'capture') startCapture(false);
  } catch (error: any) { postMessage({ type: 'error', message: error.message || String(error) }); }
};

let sttProvider = 'wasm';

async function initialize(baseUrl: string) {
  const threads = Math.min(4, Math.max(1, (self as any).navigator?.hardwareConcurrency || 2));
  ort.env.wasm.numThreads = (self as any).crossOriginIsolated ? threads : 1;
  postMessage({ type: 'loading', message: 'Loading wake word ONNX assets.' });
  const assets = await Promise.all(['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'].map(async (file) => ({ file, bytes: await fetchAsset(`${baseUrl}/wake.hey-jarvis/${file}`, file) })));
  const load = async (provider: string) => Promise.all(assets.map(({ bytes }) => ort.InferenceSession.create(bytes, { executionProviders: [provider] }) as unknown as Promise<Model>));
  const started = performance.now();
  [mel, embedding, wake] = await load('wasm');
  executionProvider = 'wasm';
  postMessage({ type: 'benchmark', component: 'wake', executionProvider, threads: (self as any).crossOriginIsolated ? threads : undefined, initializationMs: Math.round(performance.now() - started) });
  await initializeVad(baseUrl);
  initialized = true;
  active = mode === 'conversation' && listening;
  postMessage({ type: 'ready' });
  void drainFrames().catch((error) => postMessage({ type: 'error', message: error.message || String(error) }));

  postMessage({ type: 'loading', message: 'Loading local Whisper speech recognition.' });
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${baseUrl}/`;
  transcriberPromise = pipeline('automatic-speech-recognition', 'stt.whisper-base-en', { dtype: 'fp32' })
    .then((pipe) => {
      transcriber = pipe;
      sttProvider = 'wasm';
      postMessage({ type: 'benchmark', component: 'stt-load', status: 'ready' });
      return pipe;
    })
    .catch((error: any) => {
      postMessage({ type: 'error', message: `Whisper speech recognition load error: ${error.message || String(error)}` });
      return null;
    });
}

async function drainFrames() {
  if (!initialized || processingFrames) return;
  processingFrames = true;
  try {
    while (pendingFrames.length) {
      await processFrame(pendingFrames.shift()!);
      if (pendingFrames.dropped) { postMessage({ type: 'benchmark', component: 'wake-queue', droppedFrames: pendingFrames.dropped, queuedLatencyMs: Math.round((maxQueuedSamples / sampleRate) * 1000) }); pendingFrames.dropped = 0; }
    }
  } finally { processingFrames = false; }
}

async function processFrame(frame: Float32Array) {
  if (!listening) return;
  const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
  preRoll.write(frame);
  if (active) {
    utterance.write(frame);
    const speechScore = vadReady ? await vadScore(frame) : null;
    const isVoiced = speechScore != null ? speechScore >= 0.35 : rms >= 0.010;
    if (isVoiced) {
      commandVoicedFrames += 1;
      silenceFrames = 0;
    } else {
      silenceFrames += 1;
    }

    const silenceTimeout = commandVoicedFrames >= 3 ? 15 : 45;
    const isFinished = silenceFrames >= silenceTimeout && utterance.length > 8_000;
    const maxDurationReached = utterance.length >= sampleRate * 15;

    if (isFinished || maxDurationReached) {
      const samples = utterance.read();
      active = mode === 'conversation';
      utterance.clear();
      silenceFrames = 0;
      commandVoicedFrames = 0;
      partialSamples = 0;

      if (!hasSpeech(samples)) {
        postMessage({ type: 'transcript', text: '', rawText: '' });
        return;
      }
      if (!transcriber && transcriberPromise) {
        postMessage({ type: 'transcribing', samples: samples.length });
        await transcriberPromise;
      }
      if (!transcriber) {
        postMessage({ type: 'error', message: 'Local Whisper speech model is still loading. Please try again shortly.' });
        return;
      }
      postMessage({ type: 'transcribing', samples: samples.length });
      const started = performance.now();
      try {
        const result = await transcriber(samples, { return_timestamps: false });
        postMessage({ type: 'benchmark', component: 'stt', executionProvider: sttProvider, inferenceMs: Math.round(performance.now() - started), samples: samples.length });
        postMessage({ type: 'transcript', text: cleanTranscript(result.text), rawText: String(result.text || '').trim() });
      } catch (error: any) {
        postMessage({ type: 'error', message: `Whisper transcription failed: ${error.message || String(error)}` });
      }
    }
    else if (utterance.length >= 48000 && utterance.length - partialSamples >= 48000) {
      partialSamples = utterance.length;
      const samples = utterance.read();
      if (!hasSpeech(samples) || !transcriber) return;
      try {
        const partial = await transcriber(samples, { return_timestamps: false });
        const text = cleanTranscript(partial.text);
        if (text) postMessage({ type: 'partial-transcript', text });
      } catch {}
    }
    return;
  }
  if (mode !== 'wake') return;
  wakeWindow.write(frame);
  if (wakeWindow.filled < wakeWindowSamples) return;
  const score = await wakeScore(wakeWindow.read());
  if (!wakeReady && features.length >= 16) { wakeReady = true; postMessage({ type: 'wake-ready' }); }
  if (!wakeReady) return;
  postMessage({ type: 'wake-score', score });
  if (score >= threshold) { startCapture(true); postMessage({ type: 'wake', preRollSamples: utterance.length }); }
}


function resetCapture() {
  active = false; utterance.clear(); silenceFrames = 0; commandVoicedFrames = 0; partialSamples = 0;
  resetVad();
}

function startCapture(includePreRoll: boolean) {
  active = true;
  utterance.clear();
  if (includePreRoll) utterance.write(preRoll.read(wakeCommandPreRollSamples));
  silenceFrames = 0;
  commandVoicedFrames = 0;
  partialSamples = 0;
  resetVad();
}

function cleanTranscript(text: string) {
  const cleaned = String(text || '')
    .replace(/^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise|wooshing(?: sound)?|water splashing|splashing|wind|breathing)[\])]?\.?)*\s*$/i, '')
    .replace(/^\s*(?:(?:hey\s+)?(?:jarvis|elvis|travis)|age\s+of\s+(?:elvis|jarvis))\b[\s,.:;-]*/i, '')
    .trim();
  return /^\s*[\[(]?[a-z\s-]+(?:sound|noise|music|breathing|wind)[\])]?\.?\s*$/i.test(cleaned) ? '' : cleaned;
}

function hasSpeech(samples: Float32Array) {
  let voiced = 0; let maxRms = 0;
  for (let offset = 0; offset + frameSamples <= samples.length; offset += frameSamples) {
    const frame = samples.subarray(offset, offset + frameSamples);
    const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
    if (rms >= 0.008) voiced += 1;
    maxRms = Math.max(maxRms, rms);
  }
  return samples.length >= 8_000 && voiced >= 2 && maxRms >= 0.010;
}

async function initializeVad(baseUrl: string) {
  try {
    postMessage({ type: 'loading', message: 'Loading Silero voice activity detector.' });
    const bytes = await fetchAsset(`${baseUrl}/vad.silero-v6/model_quantized.onnx`, 'Silero VAD');
    vad = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }) as unknown as Model;
    vadReady = true; resetVad();
    postMessage({ type: 'benchmark', component: 'vad', executionProvider: 'wasm', status: 'ready' });
  } catch (error: any) {
    vad = null; vadReady = false;
    postMessage({ type: 'benchmark', component: 'vad', executionProvider: 'rms-fallback', status: 'unavailable', message: error.message || String(error) });
  }
}

function resetVad() {
  vadState = new Float32Array(2 * 1 * 128);
  vadContext = new Float32Array(64);
}

async function vadSegmentScore(samples: Float32Array) {
  if (!vadReady) return 0;
  resetVad();
  let voiced = 0; let total = 0; let max = 0;
  for (let offset = 0; offset < samples.length; offset += vadSamples) {
    const chunk = new Float32Array(vadSamples);
    chunk.set(samples.slice(offset, offset + vadSamples));
    const score = await vadScore(chunk);
    total += score; max = Math.max(max, score); if (score >= 0.5) voiced += 1;
  }
  return Math.max(max, voiced >= 4 ? total / Math.max(1, Math.ceil(samples.length / vadSamples)) : 0);
}

async function vadScore(samples: Float32Array) {
  if (!vad) return 0;
  const chunk = new Float32Array(vadSamples);
  chunk.set(samples.slice(0, vadSamples));
  const input = new Float32Array(vadContext.length + chunk.length);
  input.set(vadContext); input.set(chunk, vadContext.length);
  const feeds = {
    input: new ort.Tensor('float32', input, [1, input.length]),
    state: new ort.Tensor('float32', vadState, [2, 1, 128]),
    sr: new ort.Tensor('int64', BigInt64Array.of(16000n), [])
  };
  const result = await vad.run(feeds);
  const output = result[vad.outputNames[0]].data as Float32Array;
  const nextState = result[vad.outputNames[1]]?.data as Float32Array | undefined;
  if (nextState) vadState = new Float32Array(nextState);
  vadContext = input.slice(-64);
  return Number(output[0] || 0);
}

async function fetchAsset(url: string, label: string) {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Unable to load voice asset ${label} (${response.status}).`);
  }
  return response.arrayBuffer();
}

async function wakeScore(samples: Float32Array) {
  const started = performance.now();
  const melResult = await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', samples, [1, samples.length]) });
  const rawMel = melResult[mel.outputNames[0]]; const normalized = Float32Array.from(rawMel.data as Float32Array, (value) => value / 10 + 2);
  const embeddingResult = await embedding.run({ [embedding.inputNames[0]]: new ort.Tensor('float32', normalized, [1, 76, 32, 1]) });
  features.push(new Float32Array(embeddingResult[embedding.outputNames[0]].data as Float32Array)); if (features.length > 16) features = features.slice(-16); if (features.length < 16) return 0;
  const stacked = new Float32Array(16 * 96); features.forEach((feature, index) => stacked.set(feature.slice(0, 96), index * 96));
  const result = await wake.run({ [wake.inputNames[0]]: new ort.Tensor('float32', stacked, [1, 16, 96]) });
  if (!benchmarkedWake) { benchmarkedWake = true; postMessage({ type: 'benchmark', component: 'wake', executionProvider, inferenceMs: Math.round(performance.now() - started) }); }
  return Number(result[wake.outputNames[0]].data[0]);
}

