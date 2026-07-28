import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsNative from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const openWakeWord = 'https://github.com/dscripka/openWakeWord/releases/download/v0.5.1';
const kokoro = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
const whisperRevision = '1ce97262654afc8ecf4e169e8f40136524f78e23';
const kokoroRuntimeRevision = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
const whisper = `https://huggingface.co/onnx-community/whisper-base.en-ONNX/resolve/${whisperRevision}`;
const kokoroRuntime = `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${kokoroRuntimeRevision}`;

export const voiceModelManifest = [
  { id: 'wake.hey-jarvis', directory: 'wake/hey-jarvis', family: 'openWakeWord', license: 'CC-BY-NC-SA-4.0', source: openWakeWord, revision: 'v0.5.1', files: [
    ['hey_jarvis_v0.1.onnx', `${openWakeWord}/hey_jarvis_v0.1.onnx`, '94a13cfe60075b132f6a472e7e462e8123ee70861bc3fb58434a73712ee0d2cb'],
    ['melspectrogram.onnx', `${openWakeWord}/melspectrogram.onnx`, 'ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f'],
    ['embedding_model.onnx', `${openWakeWord}/embedding_model.onnx`, '70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f']
  ] },
  { id: 'stt.whisper-base-en', directory: 'stt/whisper-base-en', family: 'Whisper ONNX', license: 'MIT', source: whisper, revision: whisperRevision, files: [
    ['config.json', `${whisper}/config.json`, 'ef0730dabc8b7caa9e602779f417aa937f28edd40e05ba086391878553756730'], ['generation_config.json', `${whisper}/generation_config.json`, 'ff40d10a46d2da04c63a14af4e6a6afd212277494970f9520f1d03ead58bb7e9'],
    ['preprocessor_config.json', `${whisper}/preprocessor_config.json`, 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d'], ['tokenizer.json', `${whisper}/tokenizer.json`, '287537d5be89a39bd18e7e3875ad9900faa668493fb759392b8f52a492eca5db'],
    ['tokenizer_config.json', `${whisper}/tokenizer_config.json`, '7498445adabf4fd836db90b0f0d979ca9dc0b543528e5d9f1912430a5879e212'], ['vocab.json', `${whisper}/vocab.json`, 'f6bd25a65e4e63ca31360e9fb11c7e4f9a391a78385d640acd814092dd6eee4f'],
    ['merges.txt', `${whisper}/merges.txt`, '1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5'], ['special_tokens_map.json', `${whisper}/special_tokens_map.json`, '98bdf3ec5b32e31575b02f64b0a32bde7c0449075d34484a7df9bdd3cdeb9fb9'],
    ['onnx/encoder_model.onnx', `${whisper}/onnx/encoder_model.onnx`, '1ce3812c8a170ed96205ebc418d1a4fe7327211c432762dc41c918d46c48dfc7'], ['onnx/decoder_model_merged.onnx', `${whisper}/onnx/decoder_model_merged.onnx`, '44a4d95b8c694573bb12f08761ec397156fd683eda01a212e3480f7ec2b0bd3f']
  ] },
  { id: 'tts.kokoro-v1', directory: 'tts/kokoro-v1', family: 'Kokoro', license: 'Apache-2.0', source: kokoro, revision: 'model-files-v1.0', files: [
    ['kokoro-v1.0.onnx', `${kokoro}/kokoro-v1.0.onnx`, '7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5'], ['voices-v1.0.bin', `${kokoro}/voices-v1.0.bin`, 'bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d']
  ], defaultVoice: 'bf_isabella' },
  { id: 'tts.kokoro-runtime', directory: 'tts/kokoro-runtime', family: 'Kokoro runtime adapter', license: 'Apache-2.0', source: kokoroRuntime, revision: kokoroRuntimeRevision, files: [
    ['config.json', `${kokoroRuntime}/config.json`, 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f'], ['tokenizer.json', `${kokoroRuntime}/tokenizer.json`, '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34'], ['tokenizer_config.json', `${kokoroRuntime}/tokenizer_config.json`, 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20'], ['onnx/model_q4f16.onnx', `${kokoroRuntime}/onnx/model_q4f16.onnx`, 'd1a508a6a29671ead84fac99c7401fbd3c21a583fc6ed1406d1ec974d53bf45f'], ['voices/bf_isabella.bin', `${kokoroRuntime}/voices/bf_isabella.bin`, '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f']
  ] }
];

export class VoiceModelBootstrap {
  constructor({ root = process.env.JARVIS_MODEL_DIR || path.resolve('models'), temporaryRoot = process.env.JARVIS_TEMP_DIR || path.resolve('cache', 'temp'), manifest = voiceModelManifest, publish = () => {} } = {}) { this.root = root; this.temporaryRoot = temporaryRoot; this.manifest = manifest; this.publish = publish; this.verified = new Map(); }
  async status() {
    return Promise.all(this.manifest.map(async (model) => ({ ...model, files: undefined, ready: await this.ready(model) })));
  }
  modelRoot(model) { return path.join(this.root, model.directory); }
  async ready(model) {
    return (await Promise.all(model.files.map(([file, _url, expected]) => this.verify(path.join(this.modelRoot(model), file), expected, file)))).every(Boolean);
  }
  file(modelId, relativePath) { const model = this.manifest.find((item) => item.id === modelId); if (!model || !model.files.some(([file]) => file === relativePath)) return null; return path.join(this.modelRoot(model), relativePath); }
  async install(modelId) {
    const model = this.manifest.find((item) => item.id === modelId);
    if (!model) throw new Error('Unknown local voice model.');
    const modelRoot = this.modelRoot(model);
    await fs.mkdir(modelRoot, { recursive: true });
    for (let index = 0; index < model.files.length; index += 1) {
      const [file, url, expected] = model.files[index]; const destination = path.join(modelRoot, file);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      this.publish({ type: 'bootstrap-progress', model: model.id, file, completed: index, total: model.files.length });
      if (!(await this.verify(destination, expected, file))) { await fs.rm(destination, { force: true }); await download(url, destination, path.join(this.temporaryRoot, 'downloads', model.id, `${file}.partial`)); }
      const hash = await sha256(destination);
      if (hash !== expected) { await fs.rm(destination, { force: true }); throw new Error(`Hash verification failed for ${model.id}/${file}.`); }
      await fs.writeFile(`${destination}.sha256`, `${expected}  ${file}\n`);
      this.verified.set(destination, { size: (await fs.stat(destination)).size, mtimeMs: (await fs.stat(destination)).mtimeMs, hash: expected });
    }
    this.publish({ type: 'bootstrap-progress', model: model.id, completed: model.files.length, total: model.files.length, status: 'complete' });
    return { id: model.id, root: modelRoot, ready: true };
  }
  async verify(file, expected, label = path.basename(file)) {
    try {
      const entry = await fs.stat(file); if (!entry.isFile() || entry.size === 0) return false;
      const cached = this.verified.get(file); if (cached?.size === entry.size && cached.mtimeMs === entry.mtimeMs && cached.hash === expected) return true;
      const [actual, sidecar] = await Promise.all([sha256(file), fs.readFile(`${file}.sha256`, 'utf8').catch(() => '')]);
      const valid = actual === expected && sidecar.trim() === `${expected}  ${label}`;
      if (valid) this.verified.set(file, { size: entry.size, mtimeMs: entry.mtimeMs, hash: expected });
      return valid;
    } catch { return false; }
  }
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
async function sha256(file) { const hash = crypto.createHash('sha256'); const input = (await import('node:fs')).createReadStream(file); for await (const chunk of input) hash.update(chunk); return hash.digest('hex'); }
