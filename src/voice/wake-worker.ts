import * as ort from 'onnxruntime-web';
import { env, pipeline } from '@huggingface/transformers';

type Model = { run: (feeds: Record<string, ort.Tensor>) => Promise<Record<string, ort.Tensor>>; inputNames: string[]; outputNames: string[] };
let mel: Model; let embedding: Model; let wake: Model;
let transcriber: any;
let audio: number[] = []; let preRoll: number[] = []; let features: Float32Array[] = []; let active = false; let utterance: number[] = []; let silenceFrames = 0; let partialSamples = 0;
let wakeReady = false; let initialized = false; let processingFrames = false; let pendingFrames: Float32Array[] = [];
let executionProvider = 'wasm'; let benchmarkedWake = false; let listening = true; let mode = 'wake';
const threshold = 0.5;
const frameSamples = 1280;
const preRollSamples = 48_000;

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

async function initialize(baseUrl: string) {
  ort.env.wasm.numThreads = 1;
  postMessage({ type: 'loading', message: 'Loading wake word ONNX assets.' });
  const assets = await Promise.all(['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'].map(async (file) => ({ file, bytes: await fetchAsset(`${baseUrl}/wake.hey-jarvis/${file}`, file) })));
  const load = async (provider: string) => Promise.all(assets.map(({ bytes }) => ort.InferenceSession.create(bytes, { executionProviders: [provider] }) as unknown as Promise<Model>));
  const started = performance.now();
  if ((self as any).navigator?.gpu) {
    try { [mel, embedding, wake] = await load('webgpu'); await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', new Float32Array(12600), [1, 12600]) }); executionProvider = 'webgpu'; }
    catch { [mel, embedding, wake] = await load('wasm'); }
  } else [mel, embedding, wake] = await load('wasm');
  postMessage({ type: 'benchmark', component: 'wake', executionProvider, initializationMs: Math.round(performance.now() - started) });
  postMessage({ type: 'loading', message: 'Loading local Whisper speech recognition.' });
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${baseUrl}/`;
  transcriber = await pipeline('automatic-speech-recognition', 'stt.whisper-base-en', { dtype: 'fp32', device: 'wasm' });
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
    silenceFrames = rms < 0.012 ? silenceFrames + 1 : 0;
    if (silenceFrames >= 10 && utterance.length > 3200) { const samples = new Float32Array(utterance); active = mode === 'conversation'; utterance = []; silenceFrames = 0; partialSamples = 0; if (!hasSpeech(samples)) { postMessage({ type: 'transcript', text: '', rawText: '' }); return; } postMessage({ type: 'transcribing', samples: samples.length }); const started = performance.now(); const result = await transcriber(samples); postMessage({ type: 'benchmark', component: 'stt', executionProvider: 'wasm', inferenceMs: Math.round(performance.now() - started), samples: samples.length }); postMessage({ type: 'transcript', text: cleanTranscript(result.text), rawText: String(result.text || '').trim() }); }
    else if (utterance.length >= 32000 && utterance.length - partialSamples >= 32000) { partialSamples = utterance.length; const samples = new Float32Array(utterance); if (!hasSpeech(samples)) return; const partial = await transcriber(samples); const text = cleanTranscript(partial.text); if (text) postMessage({ type: 'partial-transcript', text }); }
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
}

function startCapture(includePreRoll: boolean) {
  active = true;
  utterance = includePreRoll ? preRoll.slice(Math.max(0, preRoll.length - preRollSamples + frameSamples)) : [];
  silenceFrames = 0;
  partialSamples = 0;
}

function cleanTranscript(text: string) {
  return String(text || '').replace(/^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise)[\])]?\.?)*\s*$/i, '').replace(/^\s*(?:hey\s+)?jarvis[\s,.:;-]+/i, '').trim();
}

function hasSpeech(samples: Float32Array) {
  let voiced = 0; let maxRms = 0;
  for (let offset = 0; offset + frameSamples <= samples.length; offset += frameSamples) {
    const frame = samples.slice(offset, offset + frameSamples);
    const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
    if (rms >= 0.01) voiced += 1;
    maxRms = Math.max(maxRms, rms);
  }
  return samples.length >= 8_000 && voiced >= 3 && maxRms >= 0.015;
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
