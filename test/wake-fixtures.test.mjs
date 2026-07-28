import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const modelRoot = path.resolve('models', 'wake', 'hey-jarvis');
const modelFiles = ['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'];
const installed = await Promise.all(modelFiles.map(async (file) => fs.stat(path.join(modelRoot, file)).then((entry) => entry.size > 0).catch(() => false))).then((values) => values.every(Boolean));

test('openWakeWord distinguishes the supplied Hey Jarvis fixtures from ordinary speech', { skip: !installed && 'wake model bundle is not installed' }, async () => {
  const scores = await createWakeScorer();
  const heyJarvis = await scores.max('test/fixtures/hey_jarvis.wav');
  const heyJarvisReference = await scores.max('test/fixtures/hey_jarvis_ref.wav');
  const ordinarySpeech = await scores.max('test/fixtures/hello_world.wav');
  assert.ok(heyJarvis > 0.5, `expected Hey Jarvis to activate, received ${heyJarvis}`);
  assert.ok(heyJarvisReference > 0.5, `expected reference Hey Jarvis to activate, received ${heyJarvisReference}`);
  assert.ok(ordinarySpeech < 0.5, `expected hello world to remain below the wake threshold, received ${ordinarySpeech}`);
});

async function createWakeScorer() {
  const ort = await import('onnxruntime-web');
  const load = async (file) => ort.InferenceSession.create(await fs.readFile(path.join(modelRoot, file)));
  const [mel, embedding, wake] = await Promise.all(modelFiles.map(load));
  const embed = async (samples) => {
    const melResult = await mel.run({ [mel.inputNames[0]]: new ort.Tensor('float32', samples, [1, samples.length]) });
    const normalized = Float32Array.from(melResult[mel.outputNames[0]].data, (value) => value / 10 + 2);
    const embeddingResult = await embedding.run({ [embedding.inputNames[0]]: new ort.Tensor('float32', normalized, [1, 76, 32, 1]) });
    return new Float32Array(embeddingResult[embedding.outputNames[0]].data);
  };
  return { async max(file) {
    const decoded = await wav16k(file); const samples = new Float32Array(decoded.length + 32000); samples.set(decoded, 16000);
    const features = []; let maximum = 0;
    for (let start = 0; start + 12600 <= samples.length; start += 1280) {
      features.push(await embed(samples.slice(start, start + 12600))); if (features.length > 16) features.shift();
      if (features.length === 16) { const stacked = new Float32Array(16 * 96); features.forEach((feature, index) => stacked.set(feature.slice(0, 96), index * 96)); const result = await wake.run({ [wake.inputNames[0]]: new ort.Tensor('float32', stacked, [1, 16, 96]) }); maximum = Math.max(maximum, Number(result[wake.outputNames[0]].data[0])); }
    }
    return maximum;
  } };
}

async function wav16k(file) {
  const source = await fs.readFile(file); const view = new DataView(source.buffer, source.byteOffset, source.byteLength); let offset = 12; let format; let pcm;
  while (offset + 8 <= source.length) { const id = String.fromCharCode(...source.subarray(offset, offset + 4)); const size = view.getUint32(offset + 4, true); const data = offset + 8; if (id === 'fmt ') format = { channels: view.getUint16(data + 2, true), sampleRate: view.getUint32(data + 4, true), bits: view.getUint16(data + 14, true) }; if (id === 'data') pcm = source.subarray(data, data + size); offset = data + size + (size % 2); }
  assert.deepEqual(format, { channels: 1, sampleRate: 16000, bits: 16 }, `${file} must remain mono 16-bit 16 kHz PCM`);
  return Float32Array.from(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2), (value) => value / 32768);
}
