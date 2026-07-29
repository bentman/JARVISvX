import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';

export const VOICES = ['af_bella', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'];
const SAMPLE_RATE = 24000;
const MAX_PHONEME_LENGTH = 510;
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ort = requireOnnxRuntime();
const { loadNpz } = require('npyz');
const V = Object.fromEntries(Object.entries({ ';':1,':':2,',':3,'.':4,'!':5,'?':6,' ':16,a:43,b:44,c:45,d:46,e:47,f:48,h:50,i:51,j:52,k:53,l:54,m:55,n:56,o:57,p:58,q:59,r:60,s:61,t:62,u:63,v:64,w:65,x:66,y:67,z:68,'ɑ':69,'ɐ':70,'ɒ':71,'æ':72,'ɔ':76,'ð':81,'ʤ':82,'ə':83,'ɚ':85,'ɛ':86,'ɜ':87,'ɡ':92,'ɪ':102,'ŋ':112,'θ':119,'ɹ':123,'ʃ':131,'ʧ':133,'ʊ':135,'ʌ':138,'ʒ':147,'ˈ':156,'ˌ':157,'ː':158 }));
let session; let styles; let loaded; let loading;
parentPort.on('message', async ({ id, modelPath, voicesPath, text, voice }) => {
  try {
    if (!String(text || '').trim()) { await loadRuntime(modelPath, voicesPath); parentPort.postMessage({ id, ok: true, sampleRate: SAMPLE_RATE, samples: new Float32Array() }); return; }
    const samples = await synthesize(modelPath, voicesPath, text, voice); parentPort.postMessage({ id, ok: true, sampleRate: SAMPLE_RATE, samples }, [samples.buffer]);
  }
  catch (error) { parentPort.postMessage({ id, ok: false, error: error.message || String(error) }); }
});
async function synthesize(modelPath, voicesPath, text, voice) {
  if (!VOICES.includes(voice)) throw new Error(`Unsupported local Kokoro voice: ${voice}.`);
  if (!String(text || '').trim()) throw new Error('Cannot synthesize an empty sentence.');
  const runtimeKey = `${modelPath}\u0000${voicesPath}`;
  await loadRuntime(modelPath, voicesPath);
  const voiceStyle = styles.get(voice); if (!voiceStyle) throw new Error(`Voice ${voice} is missing from voices-v1.0.bin.`);
  const phonemes = await espeak(String(text)); const tokens = [...phonemes].map((x) => V[x]).filter((x) => x !== undefined).slice(0, MAX_PHONEME_LENGTH);
  if (!tokens.length) throw new Error('No supported Kokoro phonemes were produced.');
  const width = voiceStyle.shape.at(-1); const index = Math.min(tokens.length, voiceStyle.shape[0] - 1); const style = voiceStyle.data.slice(index * width, (index + 1) * width);
  const ids = BigInt64Array.from([0, ...tokens, 0], BigInt); const names = new Set(session.inputNames);
  const feeds = names.has('input_ids') ? { input_ids: new ort.Tensor('int64', ids, [1, ids.length]), style: new ort.Tensor('float32', style, [1, width]), speed: new ort.Tensor('int32', Int32Array.of(1), [1]) } : { tokens: new ort.Tensor('int64', ids, [1, ids.length]), style: new ort.Tensor('float32', style, [1, width]), speed: new ort.Tensor('float32', Float32Array.of(1), [1]) };
  const output = await session.run(feeds); return new Float32Array(output[session.outputNames[0]].data);
}
async function loadRuntime(modelPath, voicesPath) {
  const runtimeKey = `${modelPath}\u0000${voicesPath}`;
  if (loaded === runtimeKey) return;
  if (loading?.key === runtimeKey) return loading.promise;
  loading = { key: runtimeKey, promise: (async () => {
    session = await ort.InferenceSession.create(modelPath);
    styles = await loadBundle(voicesPath);
    loaded = runtimeKey;
  })() };
  try { await loading.promise; }
  finally { if (loading?.key === runtimeKey) loading = undefined; }
}
function espeak(text) { return new Promise((resolve, reject) => { const child = spawn(process.env.JARVIS_ESPEAK_PATH || 'espeak-ng', ['--ipa=3', '-q', text], { windowsHide: true }); let out = ''; child.stdout.on('data', (x) => out += x); child.on('error', () => reject(new Error('Local eSpeak NG is unavailable.'))); child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`Local eSpeak NG failed (${code}).`))); }); }
async function loadBundle(voicesPath) {
  const bundle = await loadNpz(voicesPath, { wrapResult: true });
  const result = new Map();
  for (const voice of VOICES) {
    const entry = bundle[voice];
    if (!entry || entry.dtype !== '<f4' || !Array.isArray(entry.shape)) throw new Error(`Voice ${voice} is missing from voices-v1.0.bin.`);
    result.set(voice, { shape: entry.shape, data: Float32Array.from(entry.data.flat(2)) });
  }
  return result;
}
function requireOnnxRuntime() {
  try { return require('onnxruntime-node'); }
  catch (error) {
    try { return require(path.join(here, '..', 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-node')); }
    catch { throw error; }
  }
}
