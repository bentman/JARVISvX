import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const modelRoot = path.resolve('models', 'tts', 'kokoro-runtime');
const required = ['config.json', 'tokenizer.json', 'onnx/model_q4f16.onnx', 'voices/bf_isabella.bin'];
const installed = await Promise.all(required.map(async (file) => fs.stat(path.join(modelRoot, file)).then((entry) => entry.size > 0).catch(() => false))).then((values) => values.every(Boolean));

test('local Kokoro produces bf_isabella audio without network access', { skip: !installed && 'Kokoro runtime bundle is not installed' }, async () => {
  const { env } = await import('@huggingface/transformers');
  const { KokoroTTS, TextSplitterStream } = await import('kokoro-js');
  env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = `${path.resolve('models')}${path.sep}`;
  const tts = await KokoroTTS.from_pretrained(modelRoot, { dtype: 'q4f16', device: 'cpu' });
  try {
    const output = await tts.generate('JARVIS is ready.', { voice: 'bf_isabella' });
    assert.ok(output.audio.length > 0);
    const splitter = new TextSplitterStream(); const iterator = tts.stream(splitter, { voice: 'bf_isabella' })[Symbol.asyncIterator]();
    splitter.push('The local voice stream is ready.'); splitter.flush();
    const streamed = await iterator.next();
    assert.equal(streamed.done, false);
    assert.ok(streamed.value.audio.audio.length > 0);
    await iterator.return?.();
  } finally { await tts.model.dispose?.(); }
});
