import * as ort from 'onnxruntime-web';
import { env, pipeline } from '@huggingface/transformers';

type Model = { run: (feeds: Record<string, ort.Tensor>) => Promise<Record<string, ort.Tensor>>; inputNames: string[]; outputNames: string[] };
let mel: Model; let embedding: Model; let wake: Model;
let transcriber: any;
let audio: number[] = []; let features: Float32Array[] = []; let active = false; let utterance: number[] = []; let silenceFrames = 0; let partialSamples = 0;
let wakeReady = false; let initialized = false; let processingFrames = false; let pendingFrames: Float32Array[] = [];
let executionProvider = 'wasm'; let benchmarkedWake = false; let listening = true;
const threshold = 0.5;

self.onmessage = async ({ data }: MessageEvent) => {
  try {
    if (data.type === 'init') { listening = data.enabled !== false; return await initialize(data.baseUrl); }
    if (data.type === 'listening') { listening = Boolean(data.enabled); if (!listening) { active = false; utterance = []; silenceFrames = 0; partialSamples = 0; } return; }
    if (data.type === 'audio') { pendingFrames.push(new Float32Array(data.samples)); void drainFrames().catch((error) => postMessage({ type: 'error', message: error.message || String(error) })); return; }
    if (data.type === 'reset' || data.type === 'interrupt') { active = false; utterance = []; silenceFrames = 0; partialSamples = 0; pendingFrames = []; }
    if (data.type === 'capture') { active = true; utterance = []; silenceFrames = 0; partialSamples = 0; }
  } catch (error: any) { postMessage({ type: 'error', message: error.message || String(error) }); }
};

async function initialize(baseUrl: string) {
  ort.env.wasm.numThreads = 1;
  const assets = await Promise.all(['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'].map(async (file) => ({ file, bytes: await (await fetch(`${baseUrl}/wake.hey-jarvis/${file}`)).arrayBuffer() })));
  const load = async (provider: string) => Promise.all(assets.map(({ bytes }) => ort.InferenceSession.create(bytes, { executionProviders: [provider] }) as unknown as Promise<Model>));
  const started = performance.now();
  if ((self as any).navigator?.gpu) {
    try { [mel, embedding, wake] = await load('webgpu'); await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', new Float32Array(12600), [1, 12600]) }); executionProvider = 'webgpu'; }
    catch { [mel, embedding, wake] = await load('wasm'); }
  } else [mel, embedding, wake] = await load('wasm');
  postMessage({ type: 'benchmark', component: 'wake', executionProvider, initializationMs: Math.round(performance.now() - started) });
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${baseUrl}/`;
  transcriber = await pipeline('automatic-speech-recognition', 'stt.whisper-base-en', { dtype: 'fp32', device: 'wasm' });
  initialized = true; void drainFrames().catch((error) => postMessage({ type: 'error', message: error.message || String(error) }));
}

async function drainFrames() {
  if (!initialized || processingFrames) return;
  processingFrames = true;
  try { while (pendingFrames.length) await processFrame(pendingFrames.shift()!); } finally { processingFrames = false; }
}

async function processFrame(frame: Float32Array) {
  if (!listening) return;
  const rms = Math.sqrt(frame.reduce((sum, sample) => sum + sample * sample, 0) / frame.length);
  if (active) {
    utterance.push(...frame);
    silenceFrames = rms < 0.012 ? silenceFrames + 1 : 0;
    if (silenceFrames >= 10 && utterance.length > 3200) { const samples = new Float32Array(utterance); active = false; utterance = []; silenceFrames = 0; partialSamples = 0; postMessage({ type: 'transcribing' }); const started = performance.now(); const result = await transcriber(samples); postMessage({ type: 'benchmark', component: 'stt', executionProvider: 'wasm', inferenceMs: Math.round(performance.now() - started) }); postMessage({ type: 'transcript', text: result.text.trim() }); }
    else if (utterance.length >= 32000 && utterance.length - partialSamples >= 32000) { partialSamples = utterance.length; const partial = await transcriber(new Float32Array(utterance)); if (partial.text.trim()) postMessage({ type: 'partial-transcript', text: partial.text.trim() }); }
    return;
  }
  audio.push(...frame); if (audio.length > 12600) audio = audio.slice(-12600); if (audio.length < 12600) return;
  const score = await wakeScore(new Float32Array(audio));
  if (!wakeReady && features.length >= 16) { wakeReady = true; postMessage({ type: 'ready' }); }
  if (!wakeReady) return;
  postMessage({ type: 'wake-score', score });
  if (score >= threshold) { active = true; utterance = []; silenceFrames = 0; postMessage({ type: 'wake' }); }
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
