import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { VoiceModelBootstrap, voiceModelManifest } from '../lib/model-bootstrap.mjs';

test('voice assets are ready only when every required file is present and non-empty', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-'));
  const temporaryRoot = path.join(root, 'cache', 'temp');
  const model = { id: 'fixture', directory: 'wake/fixture', files: [['model.bin', 'https://example.test/model.bin']] };
  const bootstrap = new VoiceModelBootstrap({ root: path.join(root, 'models'), temporaryRoot, manifest: [model] });
  const modelRoot = path.join(bootstrap.root, model.directory);
  await fs.mkdir(modelRoot, { recursive: true });
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), '');
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, false);
  await fs.writeFile(path.join(modelRoot, model.files[0][0]), 'model');
  assert.equal((await bootstrap.status()).find((item) => item.id === model.id).ready, true);
  assert.equal(bootstrap.file(model.id, 'model.bin'), path.join(modelRoot, 'model.bin'));
  assert.equal(bootstrap.temporaryRoot, temporaryRoot);
  await fs.rm(root, { recursive: true, force: true });
});

test('bootstrap downloads only missing artifacts from their declared source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-'));
  const model = { id: 'fixture', directory: 'tts/fixture', files: [['model.onnx', 'https://example.test/model.onnx'], ['voices.bin', 'https://example.test/voices.bin']] };
  const bootstrap = new VoiceModelBootstrap({ root: path.join(root, 'models'), temporaryRoot: path.join(root, 'cache', 'temp'), manifest: [model] });
  const modelRoot = path.join(bootstrap.root, model.directory);
  await fs.mkdir(modelRoot, { recursive: true });
  await fs.writeFile(path.join(modelRoot, 'model.onnx'), 'present');
  const originalFetch = globalThis.fetch; const requests = [];
  globalThis.fetch = async (url) => { requests.push(String(url)); return new Response('voice-bundle'); };
  try {
    await bootstrap.install(model.id);
    assert.deepEqual(requests, ['https://example.test/voices.bin']);
    assert.equal(await fs.readFile(path.join(modelRoot, 'voices.bin'), 'utf8'), 'voice-bundle');
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(root, { recursive: true, force: true });
  }
});


test('every manifest URL resolves through the revision its entry records', async () => {
  for (const model of voiceModelManifest) {
    for (const [file, url] of model.files) {
      assert.ok(url.includes(model.revision), `${model.id}/${file} must be served from ${model.revision}, not ${url}`);
      assert.ok(!/\/resolve\/main\//.test(url), `${model.id}/${file} must not resolve through a mutable branch`);
    }
  }
});

test('every manifest entry declares the size and digest its download must produce', () => {
  for (const model of voiceModelManifest) {
    for (const [file, , bytes, sha256] of model.files) {
      assert.ok(Number.isInteger(bytes) && bytes > 0, `${model.id}/${file} needs an expected byte size`);
      assert.match(String(sha256), /^[0-9a-f]{64}$/, `${model.id}/${file} needs a sha256`);
    }
  }
});

test('an artifact is usable only when it matches its manifest entry, and a bad download is refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-digest-'));
  const body = 'the real artifact';
  const digest = createHash('sha256').update(body).digest('hex');

  let served = body;
  let requests = 0;
  const server = http.createServer((_req, res) => { requests += 1; res.writeHead(200).end(served); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/artifact.onnx`;

  const manifest = [{ id: 'test.model', directory: 'test/model', family: 'Test', source: url, revision: 'v1', files: [['artifact.onnx', url, Buffer.byteLength(body), digest]] }];
  const bootstrap = new VoiceModelBootstrap({ root, temporaryRoot: path.join(root, 'tmp'), manifest });
  const target = path.join(root, 'test/model/artifact.onnx');

  try {
    await bootstrap.install('test.model');
    assert.equal(await fs.readFile(target, 'utf8'), body);
    assert.equal(requests, 1);

    // A validated artifact is not fetched again.
    await bootstrap.install('test.model');
    assert.equal(requests, 1, 'a matching artifact is skipped on the next start');

    // A file that no longer matches is replaced, not trusted.
    await fs.writeFile(target, 'tampered');
    assert.equal((await bootstrap.status())[0].ready, false, 'a mismatched artifact is not ready');
    await bootstrap.install('test.model');
    assert.equal(await fs.readFile(target, 'utf8'), body, 'and is replaced from its source');

    // A source serving different bytes is refused rather than published.
    served = 'something else entirely';
    await fs.rm(target);
    await assert.rejects(bootstrap.install('test.model'), /Digest mismatch|Incomplete download/);
    assert.equal(await fs.access(target).then(() => true, () => false), false, 'nothing was published');
  } finally {
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('an installation that outruns its total budget is abandoned', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-models-timeout-'));
  // A server that accepts the request and never answers.
  const server = http.createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/slow.onnx`;
  const manifest = [{ id: 'slow.model', directory: 'slow', family: 'Test', source: url, revision: 'v1', files: [['slow.onnx', url, 10, 'a'.repeat(64)]] }];
  const bootstrap = new VoiceModelBootstrap({ root, temporaryRoot: path.join(root, 'tmp'), manifest });

  try {
    await assert.rejects(bootstrap.install('slow.model', { timeoutMs: 250 }));
  } finally {
    server.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
