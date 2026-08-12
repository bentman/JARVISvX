import * as ort from 'onnxruntime-web';
import { env, pipeline } from '@huggingface/transformers';

type Model = { run: (feeds: Record<string, ort.Tensor>) => Promise<Record<string, ort.Tensor>>; inputNames: string[]; outputNames: string[] };
let mel: Model; let embedding: Model; let wake: Model;
let vad: Model | null = null; let vadState = new Float32Array(2 * 1 * 128); let vadContext = new Float32Array(64); let vadReady = false;
let transcriber: any;
let audio: number[] = []; let preRoll: number[] = []; let features: Float32Array[] = []; let active = false; let utterance: number[] = []; let silenceFrames = 0; let partialSamples = 0;
let wakeReady = false; let initialized = false; let processingFrames = false; let pendingFrames: Float32Array[] = [];
let executionProvider = 'wasm'; let benchmarkedWake = false; let listening = true; let mode = 'wake';
const threshold = 0.5;
const frameSamples = 1280;
const vadSamples = 512;
const preRollSamples = 48_000;
const wakeCommandPreRollSamples = 24_000;

self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === 'init') { listening = data.enabled !== false; mode = data.mode || 'wake'; return await initialize(data.baseUrl); }
    if (data.type === 'listening') { listening = Boolean(data.enabled); if (!listening) resetCapture(); return; }
    if (data.type === 'mode') { mode = data.mode || 'wake'; resetCapture(); active = mode === 'conversation' && listening; return; }
    if (data.type === 'audio') { pendingFrames.push(new Float32Array(data.samples)); void drainFrames().catch((error) => postMessage({ type: 'error', message: error.message || String(error) })); return; }
    if (data.type === 'reset' || data.type === 'interrupt') { resetCapture(); pendingFrames = []; }
    if (data.type === 'capture') startCapture(false);
  } catch (error: any) { postMessage({ type: 'error', message: error.message || String(error) }); }
};

let sttProvider = 'wasm';

async function initialize(baseUrl: string) {
  const threads = Math.min(4, Math.max(1, (self as any).navigator?.hardwareConcurrency || 2));
  ort.env.wasm.numThreads = threads;
  postMessage({ type: 'loading', message: 'Loading wake word ONNX assets.' });
  const assets = await Promise.all(['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'].map(async (file) => ({ file, bytes: await fetchAsset(`${baseUrl}/wake.hey-jarvis/${file}`, file) })));
  const load = async (provider: string) => Promise.all(assets.map(({ bytes }) => ort.InferenceSession.create(bytes, { executionProviders: [provider] }) as unknown as Promise<Model>));
  const started = performance.now();
  if ((self as any).navigator?.gpu) {
    try { [mel, embedding, wake] = await load('webgpu'); await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', new Float32Array(12600), [1, 12600]) }); executionProvider = 'webgpu'; }
    catch { [mel, embedding, wake] = await load('wasm'); }
  } else [mel, embedding, wake] = await load('wasm');
  postMessage({ type: 'benchmark', component: 'wake', executionProvider, threads: executionProvider === 'wasm' ? threads : undefined, initializationMs: Math.round(performance.now() - started) });
  await initializeVad(baseUrl);
  postMessage({ type: 'loading', message: 'Loading local Whisper speech recognition.' });
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${baseUrl}/`;
  if (executionProvider === 'webgpu') {
    try {
      transcriber = await pipeline('automatic-speech-recognition', 'stt.whisper-base-en', { dtype: 'fp32', device: 'webgpu' });
      sttProvider = 'webgpu';
    } catch {
      transcriber = await pipeline('automatic-speech-recognition', 'stt.whisper-base-en', { dtype: 'fp32', device: 'wasm' });
      sttProvider = 'wasm';
    }
  } else {
    transcriber = await pipeline('automatic-speech-recognition', 'stt.whisper-base-en', { dtype: 'fp32', device: 'wasm' });
    sttProvider = 'wasm';
  }
  initialized = true; active = mode === 'conversation' && listening; postMessage({ type: 'ready' }); void drainFrames().catch((error) => postMessage({ type: 'error', message: error.message || String(error) }));
}

async function drainFrames() {
  if (!initialized || processingFrames) return;
  processingFrames = true;
  try { while (pendingFrames.length) await processFrame(pendingFrames.shift()!); } finally { processingFrames = false; }
}

async function processFrame(frame: Float32Array) {
  if (!listening) return;
  const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
  preRoll.push(...frame); if (preRoll.length > preRollSamples) preRoll = preRoll.slice(-preRollSamples);
  if (active) {
    utterance.push(...frame);
    const speechScore = vadReady ? await vadScore(frame) : null;
    const quiet = speechScore == null ? rms < 0.012 : speechScore < 0.35 && rms < 0.018;
    silenceFrames = quiet ? silenceFrames + 1 : 0;
    if (silenceFrames >= 12 && utterance.length > 8_000) { const samples = new Float32Array(utterance); active = mode === 'conversation'; utterance = []; silenceFrames = 0; partialSamples = 0; if (!(await hasSpeech(samples))) { postMessage({ type: 'transcript', text: '', rawText: '' }); return; } postMessage({ type: 'transcribing', samples: samples.length }); const started = performance.now(); const result = await transcriber(samples, { return_timestamps: false, language: 'en', task: 'transcribe' }); postMessage({ type: 'benchmark', component: 'stt', executionProvider: sttProvider, inferenceMs: Math.round(performance.now() - started), samples: samples.length }); postMessage({ type: 'transcript', text: cleanTranscript(result.text), rawText: String(result.text || '').trim() }); }
    else if (utterance.length >= 48000 && utterance.length - partialSamples >= 48000) { partialSamples = utterance.length; const samples = new Float32Array(utterance); if (!(await hasSpeech(samples))) return; const partial = await transcriber(samples, { return_timestamps: false, language: 'en', task: 'transcribe' }); const text = cleanTranscript(partial.text); if (text) postMessage({ type: 'partial-transcript', text }); }
    return;
  }
  if (mode !== 'wake') return;
  audio.push(...frame); if (audio.length > 12600) audio = audio.slice(-12600); if (audio.length < 12600) return;
  const score = await wakeScore(new Float32Array(audio));
  if (!wakeReady && features.length >= 16) { wakeReady = true; postMessage({ type: 'wake-ready' }); }
  if (!wakeReady) return;
  postMessage({ type: 'wake-score', score });
  if (score >= threshold) { startCapture(true); postMessage({ type: 'wake', preRollSamples: utterance.length }); }
}


function resetCapture() {
  active = false; utterance = []; silenceFrames = 0; partialSamples = 0;
  resetVad();
}

function startCapture(includePreRoll: boolean) {
  active = true;
  utterance = includePreRoll ? preRoll.slice(-wakeCommandPreRollSamples) : [];
  silenceFrames = 0;
  partialSamples = 0;
  resetVad();
}

function cleanTranscript(text: string) {
  const cleaned = String(text || '').replace(/^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise|wooshing(?: sound)?|wind|breathing)[\])]?\.?)*\s*$/i, '').replace(/^\s*(?:hey\s+)?jarvis\b[\s,.:;-]*/i, '').trim();
  return /^\s*[\[(]?[a-z\s-]+(?:sound|noise|music|breathing|wind)[\])]?\.?\s*$/i.test(cleaned) ? '' : cleaned;
}

async function hasSpeech(samples: Float32Array) {
  let voiced = 0; let maxRms = 0; let energy = 0;
  for (let offset = 0; offset + frameSamples <= samples.length; offset += frameSamples) {
    const frame = samples.slice(offset, offset + frameSamples);
    const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
    energy += rms;
    if (rms >= 0.014) voiced += 1;
    maxRms = Math.max(maxRms, rms);
  }
  if (vadReady) {
    const score = await vadSegmentScore(samples);
    return samples.length >= 12_000 && score >= 0.5 && voiced >= 3 && maxRms >= 0.018;
  }
  const avgRms = energy / Math.max(1, Math.floor(samples.length / frameSamples));
  return samples.length >= 12_000 && voiced >= 5 && maxRms >= 0.022 && avgRms >= 0.008;
}

async function initializeVad(baseUrl: string) {
  try {
    postMessage({ type: 'loading', message: 'Loading optional Silero voice activity detector.' });
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

