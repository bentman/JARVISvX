import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { VoiceModelBootstrap } from '../lib/model-bootstrap.mjs';

test('voice assets are ready only when every required file matches its pinned hash', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-'));
  const temporaryRoot = path.join(root, 'cache', 'temp');
  const expected = crypto.createHash('sha256').update('model').digest('hex');
  const model = { id: 'fixture', directory: 'wake/fixture', files: [['model.bin', 'https://example.test/model.bin', expected]] };
  const bootstrap = new VoiceModelBootstrap({ root: path.join(root, 'models'), temporaryRoot, manifest: [model] });
  const modelRoot = path.join(bootstrap.root, model.directory);
  await fs.mkdir(modelRoot, { recursive: true });
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), '');
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, false);
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), 'model');
  await fs.writeFile(path.join(modelRoot, `${model.files[0][0]}.sha256`), `${expected}  ${model.files[0][0]}\n`);
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, true);
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), 'corrupt');
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, false);
  assert.equal(bootstrap.file(model.id, 'model.bin'), path.join(modelRoot, 'model.bin'));
  assert.equal(bootstrap.temporaryRoot, temporaryRoot);
  await fs.rm(root, { recursive: true, force: true });
});
