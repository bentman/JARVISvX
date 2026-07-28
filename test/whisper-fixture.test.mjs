import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const modelRoot = path.resolve('models', 'stt', 'whisper-base-en');
const required = ['config.json', 'tokenizer.json', 'onnx/encoder_model.onnx', 'onnx/decoder_model_merged.onnx'];
const installed = await Promise.all(required.map(async (file) => fs.stat(path.join(modelRoot, file)).then((entry) => entry.size > 0).catch(() => false))).then((values) => values.every(Boolean));

test('local Whisper transcribes the supplied speech fixture without network access', { skip: !installed && 'Whisper model bundle is not installed' }, async () => {
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${path.resolve('models')}${path.sep}`;
  const source = await wav16k('test/fixtures/hello_world.wav');
  const transcribe = await pipeline('automatic-speech-recognition', modelRoot, { dtype: 'fp32', device: 'cpu' });
  try { const result = await transcribe(source); assert.match(result.text, /hello/i); }
  finally { await transcribe.dispose?.(); }
});

async function wav16k(file) {
  const source = await fs.readFile(file); const view = new DataView(source.buffer, source.byteOffset, source.byteLength); let offset = 12; let format; let pcm;
  while (offset + 8 <= source.length) { const id = String.fromCharCode(...source.subarray(offset, offset + 4)); const size = view.getUint32(offset + 4, true); const data = offset + 8; if (id === 'fmt ') format = { channels: view.getUint16(data + 2, true), sampleRate: view.getUint32(data + 4, true), bits: view.getUint16(data + 14, true) }; if (id === 'data') pcm = source.subarray(data, data + size); offset = data + size + (size % 2); }
  assert.deepEqual(format, { channels: 1, sampleRate: 16000, bits: 16 });
  return Float32Array.from(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2), (value) => value / 32768);
}
