import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsNative from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRuntimePaths } from './runtime-paths.mjs';

const openWakeWord = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1';
const kokoro = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
const whisperRevision = '1ce97262654afc8ecf4e169e8f40136524f78e23';
const whisper = `https://huggingface.co/onnx-community/whisper-base.en-ONNX/resolve/${whisperRevision}`;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

const sileroRevision = 'd5f05343ab09671d549093fb9c1871f118577903';
const sileroVad = `https://huggingface.co/BricksDisplay/silero-vad-6.2/resolve/${sileroRevision}`;

export const voiceModelManifest = [
  { id: 'wake.hey-jarvis', directory: 'wake/hey-jarvis', family: 'openWakeWord', source: openWakeWord, revision: 'v0.5.1', files: [
    ['hey_jarvis_v0.1.onnx', `${openWakeWord}/hey_jarvis_v0.1.onnx`, 1271370, '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb'],
    ['melspectrogram.onnx', `${openWakeWord}/melspectrogram.onnx`, 1087958, 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f'],
    ['embedding_model.onnx', `${openWakeWord}/embedding_model.onnx`, 1326578, '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f']
  ] },
  { id: 'stt.whisper-base-en', directory: 'stt/whisper-base-en', family: 'Whisper ONNX', source: whisper, revision: whisperRevision, files: [
    ['config.json', `${whisper}/config.json`, 1364, 'ef0730dabc8b7caa9e602779f417aa937f28edd40e05ba086391878553756730'], ['generation_config.json', `${whisper}/generation_config.json`, 1556, 'ff40d10a46d2da04c63a14af4e6a6afd212277494970f9520f1d03ead58bb7e9'],
    ['preprocessor_config.json', `${whisper}/preprocessor_config.json`, 339, 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'], ['tokenizer.json', `${whisper}/tokenizer.json`, 3855707, '287537d5be89a39bd18e7e3875ad9900faa668493fb759392b8f52a492eca5db'],
    ['tokenizer_config.json', `${whisper}/tokenizer_config.json`, 282692, '7498445adabf4fd836db90b0f0d979ca9dc0b543528e5d9f1912430a5879e212'], ['vocab.json', `${whisper}/vocab.json`, 999186, 'f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f'],
    ['merges.txt', `${whisper}/merges.txt`, 456318, '1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5'], ['special_tokens_map.json', `${whisper}/special_tokens_map.json`, 2173, '98bdf3ec5b32e31575b02f64b0a32bde7c0449075d34484a7df9bdd3cdeb9fb9'],
    ['onnx/encoder_model.onnx', `${whisper}/onnx/encoder_model.onnx`, 82435426, '1ce3812c8a170ed96205ebc418d1a4fe7327211c432762dc41c918d46c48dfc7'], ['onnx/decoder_model_merged.onnx', `${whisper}/onnx/decoder_model_merged.onnx`, 208444447, '44a4d95b8c694573bb12f08761ec397156fd683eda01a212e3480f7ec2b0bd3f']
  ] },
  { id: 'tts.kokoro-v1', directory: 'tts/kokoro-v1', family: 'Kokoro', source: kokoro, revision: 'model-files-v1.0', files: [
    ['kokoro-v1.0.onnx', `${kokoro}/kokoro-v1.0.onnx`, 325532387, '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5'],
    ['voices-v1.0.bin', `${kokoro}/voices-v1.0.bin`, 28214398, 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d']
  ], defaultVoice: 'bf_isabella' },
  { id: 'vad.silero-v6', directory: 'vad/silero-v6', family: 'Silero VAD', source: sileroVad, revision: sileroRevision, files: [
    ['model_quantized.onnx', `${sileroVad}/onnx/model_quantized.onnx`, 1502493, 'adc874eac1551c21a45c227d7d0511d7e8cf25a24d544270dcb49a9007ce8503']
  ] }
];

export class VoiceModelBootstrap {
  constructor({ root = createRuntimePaths().modelRoot, temporaryRoot = createRuntimePaths().tempRoot, manifest = voiceModelManifest, publish = () => {} } = {}) {
    this.root = root;
    this.temporaryRoot = temporaryRoot;
    this.manifest = manifest;
    this.publish = publish;
    this._digestCache = new Map();
  }
  async status() { return Promise.all(this.manifest.map(async (model) => ({ ...model, files: undefined, ready: await this.ready(model) }))); }
  modelRoot(model) { return path.join(this.root, model.directory); }
  async ready(model) {
    const files = await Promise.all(model.files.map(([file, , bytes, sha256]) => this.verify(path.join(this.modelRoot(model), file), { bytes, sha256 })));
    return files.every(Boolean);
  }
  file(modelId, relativePath) { const model = this.manifest.find((item) => item.id === modelId); if (!model || !model.files.some(([file]) => file === relativePath)) return null; return path.join(this.modelRoot(model), relativePath); }
  async install(modelId, { timeoutMs = INSTALL_TIMEOUT_MS, signal } = {}) {
    const model = this.manifest.find((item) => item.id === modelId);
    if (!model) throw new Error('Unknown local voice model.');
    const modelRoot = this.modelRoot(model);
    await fs.mkdir(modelRoot, { recursive: true });

    // One bound covers the whole installation, not just each request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      for (let index = 0; index < model.files.length; index += 1) {
        const [file, url, bytes, sha256] = model.files[index]; const destination = path.join(modelRoot, file);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        this.publish({ type: 'bootstrap-progress', model: model.id, file, completed: index, total: model.files.length });
        // An artifact is usable only once it matches the manifest; anything else
        // is replaced through the same temporary path.
        if (!(await this.verify(destination, { bytes, sha256 }))) {
          await fs.rm(destination, { force: true });
          await download(url, destination, path.join(this.temporaryRoot, 'downloads', model.id, `${file}.partial`), { bytes, sha256, signal: controller.signal });
        }
      }
    } finally {
      clearTimeout(timer);
    }
    this.publish({ type: 'bootstrap-progress', model: model.id, completed: model.files.length, total: model.files.length, status: 'complete' });
    return { id: model.id, root: modelRoot, ready: true };
  }
  // Existence is not integrity: a file counts only at its declared size and digest.
  // When an artifact has already been validated against its manifest hash, matching
  // size and mtimeMs confirm integrity without re-streaming hundreds of megabytes.
  async verify(file, expected = {}) {
    try {
      const entry = await fs.stat(file);
      if (!entry.isFile() || entry.size === 0) return false;
      if (expected.bytes && entry.size !== expected.bytes) return false;
      if (!expected.sha256) return true;
      const cached = this._digestCache.get(file);
      if (cached && cached.size === entry.size && cached.mtimeMs === entry.mtimeMs) {
        return cached.sha256 === expected.sha256;
      }
      const digest = await digestOf(file);
      this._digestCache.set(file, { size: entry.size, mtimeMs: entry.mtimeMs, sha256: digest });
      return digest === expected.sha256;
    } catch { return false; }
  }
}

async function digestOf(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fsNative.createReadStream(file), hash);
  return hash.digest('hex');
}

// A resumed partial cannot be digested mid-stream, so verification happens once
// the file is whole and before it is published.
async function download(url, destination, temporary, { bytes, sha256, signal } = {}) {
  await fs.mkdir(path.dirname(temporary), { recursive: true });
  let offset = 0; try { offset = (await fs.stat(temporary)).size; } catch {}
  const response = await fetch(url, { redirect: 'follow', signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  if (offset && response.status !== 206) offset = 0;
  const expected = bytes || (offset + Number(response.headers.get('content-length') || 0));
  await pipeline(Readable.fromWeb(response.body), fsNative.createWriteStream(temporary, { flags: offset ? 'a' : 'w' }), { signal });

  const actual = (await fs.stat(temporary)).size;
  if (expected && actual !== expected) {
    await fs.rm(temporary, { force: true });
    throw new Error(`Incomplete download for ${url}: expected ${expected} bytes, received ${actual}.`);
  }
  if (sha256) {
    const digest = await digestOf(temporary);
    if (digest !== sha256) {
      await fs.rm(temporary, { force: true });
      throw new Error(`Digest mismatch for ${url}: expected ${sha256}, received ${digest}.`);
    }
  }
  await fs.rename(temporary, destination);
}

