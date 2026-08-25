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
const sileroVad = 'https://huggingface.co/BricksDisplay/silero-vad-6.2/resolve/main';

export const voiceModelManifest = [
  { id: 'wake.hey-jarvis', directory: 'wake/hey-jarvis', family: 'openWakeWord', source: openWakeWord, revision: 'v0.5.1', files: [
    ['hey_jarvis_v0.1.onnx', `${openWakeWord}/hey_jarvis_v0.1.onnx`],
    ['melspectrogram.onnx', `${openWakeWord}/melspectrogram.onnx`],
    ['embedding_model.onnx', `${openWakeWord}/embedding_model.onnx`]
  ] },
  { id: 'stt.whisper-base-en', directory: 'stt/whisper-base-en', family: 'Whisper ONNX', source: whisper, revision: whisperRevision, files: [
    ['config.json', `${whisper}/config.json`], ['generation_config.json', `${whisper}/generation_config.json`],
    ['preprocessor_config.json', `${whisper}/preprocessor_config.json`], ['tokenizer.json', `${whisper}/tokenizer.json`],
    ['tokenizer_config.json', `${whisper}/tokenizer_config.json`], ['vocab.json', `${whisper}/vocab.json`],
    ['merges.txt', `${whisper}/merges.txt`], ['special_tokens_map.json', `${whisper}/special_tokens_map.json`],
    ['onnx/encoder_model.onnx', `${whisper}/onnx/encoder_model.onnx`], ['onnx/decoder_model_merged.onnx', `${whisper}/onnx/decoder_model_merged.onnx`]
  ] },
  { id: 'tts.kokoro-v1', directory: 'tts/kokoro-v1', family: 'Kokoro', source: kokoro, revision: 'model-files-v1.0', files: [
    ['kokoro-v1.0.onnx', `${kokoro}/kokoro-v1.0.onnx`],
    ['voices-v1.0.bin', `${kokoro}/voices-v1.0.bin`]
  ], defaultVoice: 'bf_isabella' },
  { id: 'vad.silero-v6', directory: 'vad/silero-v6', family: 'Silero VAD', source: sileroVad, revision: 'v6.2', files: [
    ['model_quantized.onnx', `${sileroVad}/onnx/model_quantized.onnx`]
  ] }
];

export class VoiceModelBootstrap {
  constructor({ root = createRuntimePaths().modelRoot, temporaryRoot = createRuntimePaths().tempRoot, manifest = voiceModelManifest, publish = () => {} } = {}) { this.root = root; this.temporaryRoot = temporaryRoot; this.manifest = manifest; this.publish = publish; }
  async status() { return Promise.all(this.manifest.map(async (model) => ({ ...model, files: undefined, ready: await this.ready(model) }))); }
  modelRoot(model) { return path.join(this.root, model.directory); }
  async ready(model) {
    const files = await Promise.all(model.files.map(([file]) => this.verify(path.join(this.modelRoot(model), file))));
    return files.every(Boolean);
  }
  file(modelId, relativePath) { const model = this.manifest.find((item) => item.id === modelId); if (!model || !model.files.some(([file]) => file === relativePath)) return null; return path.join(this.modelRoot(model), relativePath); }
  async install(modelId) {
    const model = this.manifest.find((item) => item.id === modelId);
    if (!model) throw new Error('Unknown local voice model.');
    const modelRoot = this.modelRoot(model);
    await fs.mkdir(modelRoot, { recursive: true });
    for (let index = 0; index < model.files.length; index += 1) {
      const [file, url] = model.files[index]; const destination = path.join(modelRoot, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      this.publish({ type: 'bootstrap-progress', model: model.id, file, completed: index, total: model.files.length });
      if (!(await this.verify(destination))) { await fs.rm(destination, { force: true }); await download(url, destination, path.join(this.temporaryRoot, 'downloads', model.id, `${file}.partial`)); }
    }
    this.publish({ type: 'bootstrap-progress', model: model.id, completed: model.files.length, total: model.files.length, status: 'complete' });
    return { id: model.id, root: modelRoot, ready: true };
  }
  async verify(file) { try { const entry = await fs.stat(file); return entry.isFile() && entry.size > 0; } catch { return false; } }
}

async function download(url, destination, temporary) {
  await fs.mkdir(path.dirname(temporary), { recursive: true });
  let offset = 0; try { offset = (await fs.stat(temporary)).size; } catch {}
  const response = await fetch(url, { redirect: 'follow', headers: offset ? { range: `bytes=${offset}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  if (offset && response.status !== 206) offset = 0;
  const expected = offset + Number(response.headers.get('content-length') || 0);
  await pipeline(Readable.fromWeb(response.body), fsNative.createWriteStream(temporary, { flags: offset ? 'a' : 'w' }));
  if (expected) {
    const actual = (await fs.stat(temporary)).size;
    if (actual !== expected) throw new Error(`Incomplete download for ${url}: expected ${expected} bytes, received ${actual}.`);
  }
  await fs.rename(temporary, destination);
}

