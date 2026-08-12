import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parentPort } from 'node:worker_threads';

const SAMPLE_RATE = 24000;
const MAX_PHONEME_LENGTH = 510;
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ort = requireOnnxRuntime();
const StreamZip = require('node-stream-zip');
const V = Object.fromEntries(Object.entries({ ';':1,':':2,',':3,'.':4,'!':5,'?':6,' ':16,a:43,b:44,c:45,d:46,e:47,f:48,h:50,i:51,j:52,k:53,l:54,m:55,n:56,o:57,p:58,q:59,r:60,s:61,t:62,u:63,v:64,w:65,x:66,y:67,z:68,'ɑ':69,'ɐ':70,'ɒ':71,'æ':72,'ɔ':76,'ð':81,'ʤ':82,'ə':83,'ɚ':85,'ɛ':86,'ɜ':87,'ɡ':92,'ɪ':102,'ŋ':112,'θ':119,'ɹ':123,'ʃ':131,'ʧ':133,'ʊ':135,'ʌ':138,'ʒ':147,'ˈ':156,'ˌ':157,'ː':158 }));
let session; let loaded; let loading; const voiceStyles = new Map();
parentPort.on('message', async ({ id, modelPath, voicesPath, text, voice }) => {
  const report = (stage, message, extra = {}) => parentPort.postMessage({ id, type: 'progress', stage, message, ...extra });
  try {
    report('request', String(text || '').trim() ? 'Kokoro synthesis request received.' : 'Kokoro warmup request received.');
    if (!String(text || '').trim()) { await loadRuntime(modelPath, voicesPath, report); report('complete', 'Kokoro runtime is warm.'); parentPort.postMessage({ id, ok: true, sampleRate: SAMPLE_RATE, samples: new Float32Array() }); return; }
    const samples = await synthesize(modelPath, voicesPath, text, voice, report); report('complete', `Kokoro produced ${samples.length} samples.`); parentPort.postMessage({ id, ok: true, sampleRate: SAMPLE_RATE, samples }, [samples.buffer]);
  }
  catch (error) { parentPort.postMessage({ id, ok: false, stage: error.stage || 'failed', error: error.message || String(error), sampleRate: SAMPLE_RATE, samples: new Float32Array() }); }
});
async function synthesize(modelPath, voicesPath, text, voice, report = () => {}) {
  if (!validVoiceName(voice)) throw new Error(`Unsupported local Kokoro voice: ${voice}.`);
  if (!String(text || '').trim()) throw new Error('Cannot synthesize an empty sentence.');
  await loadRuntime(modelPath, voicesPath, report);
  const voiceStyle = await loadVoiceStyle(voicesPath, voice, report);
  report('phonemize', 'Phonemizing text with local eSpeak NG / JS phonemizer fallback.');
  const phonemes = await phonemize(String(text)); const tokens = [...phonemes].map((x) => V[x]).filter((x) => x !== undefined).slice(0, MAX_PHONEME_LENGTH);
  report('tokens', `Kokoro received ${tokens.length} supported phoneme tokens.`, { phonemeCount: phonemes.length, tokenCount: tokens.length });
  if (!tokens.length) throw new Error('No supported Kokoro phonemes were produced.');
  const width = voiceStyle.shape.at(-1); const index = Math.min(tokens.length, voiceStyle.shape[0] - 1); const style = voiceStyle.data.slice(index * width, (index + 1) * width);
  const ids = BigInt64Array.from([0, ...tokens, 0], BigInt); const names = new Set(session.inputNames);
  const feeds = names.has('input_ids') ? { input_ids: new ort.Tensor('int64', ids, [1, ids.length]), style: new ort.Tensor('float32', style, [1, width]), speed: new ort.Tensor('int32', Int32Array.of(1), [1]) } : { tokens: new ort.Tensor('int64', ids, [1, ids.length]), style: new ort.Tensor('float32', style, [1, width]), speed: new ort.Tensor('float32', Float32Array.of(1), [1]) };
  report('inference', `Running Kokoro ONNX inference (${ids.length} ids, style width ${width}).`, { inputs: session.inputNames, outputs: session.outputNames });
  const output = await session.run(feeds); return new Float32Array(output[session.outputNames[0]].data);
}
async function loadRuntime(modelPath, _voicesPath, report = () => {}) {
  const runtimeKey = modelPath;
  if (loaded === runtimeKey) { report('runtime-ready', 'Kokoro ONNX session is already loaded.'); return; }
  if (loading?.key === runtimeKey) { report('runtime-wait', 'Waiting for in-flight Kokoro runtime load.'); return loading.promise; }
  loading = { key: runtimeKey, promise: (async () => {
    report('model-load', 'Loading Kokoro v1.0 ONNX model.');
    session = await ort.InferenceSession.create(modelPath);
    report('model-ready', `Kokoro ONNX model loaded (${session.inputNames.join(', ')} -> ${session.outputNames.join(', ')}).`);
    loaded = runtimeKey;
  })() };
  try { await loading.promise; }
  finally { if (loading?.key === runtimeKey) loading = undefined; }
}
async function phonemize(text) {
  try {
    const espeakOut = await espeak(text);
    if (espeakOut && espeakOut.trim().length > 0) return espeakOut;
  } catch {}
  return jsPhonemize(text);
}
function jsPhonemize(text) {
  const dictionary = {
    'jarvis': 'ʤɑɹvɪs', 'hello': 'hələʊ', 'world': 'wɚld', 'ready': 'ɹɛdi', 'test': 'tɛst',
    'is': 'ɪz', 'the': 'ðə', 'a': 'ə', 'an': 'æn', 'this': 'ðɪs', 'that': 'ðæt', 'to': 'tu',
    'in': 'ɪn', 'on': 'ɑn', 'at': 'æt', 'for': 'fɔɹ', 'of': 'ʌv', 'with': 'wɪð', 'by': 'baɪ',
    'from': 'fɹʌm', 'you': 'ju', 'me': 'mi', 'we': 'wi', 'be': 'bi', 'can': 'kæn', 'will': 'wɪl', 'are': 'ɑɹ',
    'yes': 'jɛs', 'no': 'no', 'okay': 'oʊkeɪ', 'ok': 'oʊkeɪ', 'system': 'sɪstəm', 'voice': 'vɔɪs', 'assistant': 'əsɪstənt',
    'one': 'wʌn', 'two': 'tu', 'three': 'θɹi', 'four': 'fɔɹ', 'five': 'faɪv', 'six': 'sɪks', 'seven': 'sɛvən', 'eight': 'eɪt', 'nine': 'naɪn', 'zero': 'zɪɹo',
    'dont': 'doʊnt', 'cant': 'kænt', 'its': 'ɪts', 'im': 'aɪm', 'whats': 'wʌts', 'theres': 'ðɛɹz'
  };
  const words = String(text || '').toLowerCase().split(/(\s+|[;:,\.!?])/);
  let result = '';
  for (const part of words) {
    if (!part) continue;
    if (/^[;:,\.!?\s]+$/.test(part)) { result += part; continue; }
    const cleanWord = part.replace(/[^a-z]/g, '');
    if (!cleanWord) continue;
    if (dictionary[cleanWord]) { result += dictionary[cleanWord]; }
    else {
      let w = cleanWord;
      w = w.replace(/ch/g, 'ʧ').replace(/sh/g, 'ʃ').replace(/th/g, 'ð').replace(/ng/g, 'ŋ').replace(/ph/g, 'f').replace(/qu/g, 'kw').replace(/ck/g, 'k').replace(/ee|ea/g, 'i').replace(/oo/g, 'u').replace(/ou|ow/g, 'aʊ').replace(/ai|ay/g, 'eɪ').replace(/oi|oy/g, 'ɔɪ').replace(/or/g, 'ɔɹ').replace(/ar/g, 'ɑɹ').replace(/er|ir|ur/g, 'ɚ').replace(/igh/g, 'aɪ').replace(/a/g, 'æ').replace(/e/g, 'ɛ').replace(/i/g, 'ɪ').replace(/o/g, 'ɑ').replace(/u/g, 'ʌ').replace(/c/g, 'k').replace(/g/g, 'ɡ').replace(/j/g, 'ʤ').replace(/r/g, 'ɹ').replace(/x/g, 'ks').replace(/y/g, 'j');
      result += w;
    }
  }
  return [...result].filter((char) => V[char] !== undefined).join('');
}
function espeak(text) { return new Promise((resolve, reject) => { const child = spawn(process.env.JARVIS_ESPEAK_PATH || 'espeak-ng', ['--ipa=3', '-q', text], { windowsHide: true }); let out = ''; child.stdout.on('data', (x) => out += x); child.on('error', () => reject(new Error('Local eSpeak NG is unavailable.'))); child.on('close', (code) => code === 0 ? resolve(out.trim()) : reject(new Error(`Local eSpeak NG failed (${code}).`))); }); }
async function loadVoiceStyle(voicesPath, voice, report = () => {}) {
  const cacheKey = `${voicesPath}\u0000${voice}`;
  if (voiceStyles.has(cacheKey)) { report('voice-ready', `Kokoro voice ${voice} is already loaded.`); return voiceStyles.get(cacheKey); }
  report('voices-load', `Loading Kokoro voice ${voice} from voices-v1.0.bin.`);
  const buffer = await readZipEntry(voicesPath, `${voice}.npy`);
  const style = parseNpyFloat32(buffer);
  voiceStyles.set(cacheKey, style);
  report('voices-ready', `Loaded Kokoro voice ${voice} (${style.shape.join('x')}).`);
  return style;
}
function readZipEntry(zipPath, entryName) {
  return new Promise((resolve, reject) => {
    const zip = new StreamZip({ file: zipPath, storeEntries: true });
    const finish = (error, value) => { zip.close(); error ? reject(error) : resolve(value); };
    zip.on('error', (error) => finish(error));
    zip.on('ready', () => {
      const entry = zip.entry(entryName);
      if (!entry) return finish(new Error(`Voice ${entryName.replace(/\.npy$/, '')} is missing from voices-v1.0.bin.`));
      zip.stream(entryName, (error, stream) => {
        if (error) return finish(error);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', (streamError) => finish(streamError));
        stream.on('end', () => finish(null, Buffer.concat(chunks)));
      });
    });
  });
}
function parseNpyFloat32(buffer) {
  if (buffer.readUInt8(0) !== 0x93 || buffer.subarray(1, 6).toString('ascii') !== 'NUMPY') throw new Error('Invalid NPY voice entry in voices-v1.0.bin.');
  const major = buffer.readUInt8(6);
  const headerLength = major <= 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8);
  const headerStart = major <= 1 ? 10 : 12;
  const header = buffer.subarray(headerStart, headerStart + headerLength).toString('ascii');
  if (!/'descr':\s*'<f4'/.test(header) || !/'fortran_order':\s*False/.test(header)) throw new Error(`Unsupported Kokoro voice NPY header: ${header.trim()}`);
  const shape = (header.match(/'shape':\s*\(([^)]*)\)/)?.[1] || '').split(',').map((value) => Number(value.trim())).filter(Number.isFinite);
  if (shape.length < 2) throw new Error(`Invalid Kokoro voice shape: ${header.trim()}`);
  const dataStart = headerStart + headerLength;
  const dataBuffer = buffer.buffer.slice(buffer.byteOffset + dataStart, buffer.byteOffset + buffer.byteLength);
  const data = new Float32Array(dataBuffer);
  return { shape, data: new Float32Array(data) };
}
function validVoiceName(voice) { return /^[a-z]{2}_[a-z0-9_]+$/i.test(String(voice || '')); }
function requireOnnxRuntime() {
  try { return require('onnxruntime-node'); }
  catch (error) {
    try { return require(path.join(here, '..', 'node_modules', '@huggingface', 'transformers', 'node_modules', 'onnxruntime-node')); }
    catch {
      try { return require('onnxruntime-web'); }
      catch { throw error; }
    }
  }
}

