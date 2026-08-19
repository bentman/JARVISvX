import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { JarvisDatabase } from '../lib/database.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { createApiRouter } from '../lib/api.mjs';

// HTTP-route-level coverage for the `/api/provider-registry` CRUD/toggle/test
// endpoints and `/api/settings/effective`. Other tests cover the underlying
// application-layer logic (test/orchestration.test.mjs); these exercise the
// actual Express routes end to end, the way test/daemon.test.mjs does for
// the rest of the router.

async function startTestServer() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-provider-routes-'));
  const db = new JarvisDatabase(path.join(directory, 'jarvis.sqlite'));
  const jarvis = createJarvisApp({ database: db });
  await jarvis.initialize();
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(jarvis));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const close = async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  };
  return { db, jarvis, base: `http://127.0.0.1:${port}/api`, close };
}

test('GET /api/provider-registry lists providers as plain JSON', async () => {
  const ctx = await startTestServer();
  try {
    const res = await fetch(`${ctx.base}/provider-registry`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(await res.json()));
  } finally {
    await ctx.close();
  }
});

test('POST /api/provider-registry creates a provider and never returns the encrypted key', async () => {
  const ctx = await startTestServer();
  try {
    const res = await fetch(`${ctx.base}/provider-registry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Test Ollama', protocol: 'ollama', base_url: 'http://127.0.0.1:1', api_key: 'super-secret', tags: ['local'], priority: 10 }),
    });
    assert.equal(res.status, 201);
    const created = await res.json();
    assert.ok(created.id);
    assert.equal(created.name, 'Test Ollama');
    assert.equal('_api_key_enc' in created, false);
    assert.equal(JSON.stringify(created).includes('super-secret'), false);
  } finally {
    await ctx.close();
  }
});

test('GET/PUT/DELETE /api/provider-registry/:id round-trip and 404 once deleted', async () => {
  const ctx = await startTestServer();
  try {
    const created = await (await fetch(`${ctx.base}/provider-registry`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Roundtrip', protocol: 'ollama', base_url: 'http://127.0.0.1:1' }),
    })).json();

    const getRes = await fetch(`${ctx.base}/provider-registry/${created.id}`);
    assert.equal(getRes.status, 200);
    assert.equal((await getRes.json()).name, 'Roundtrip');

    const putRes = await fetch(`${ctx.base}/provider-registry/${created.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priority: 5 }),
    });
    assert.equal(putRes.status, 200);
    assert.equal((await putRes.json()).priority, 5);

    const deleteRes = await fetch(`${ctx.base}/provider-registry/${created.id}`, { method: 'DELETE' });
    assert.equal(deleteRes.status, 200);
    assert.deepEqual(await deleteRes.json(), { removed: true });

    assert.equal((await fetch(`${ctx.base}/provider-registry/${created.id}`)).status, 404);
    assert.equal((await fetch(`${ctx.base}/provider-registry/${created.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ priority: 1 }),
    })).status, 404);
  } finally {
    await ctx.close();
  }
});

test('POST /api/provider-registry/:id/toggle flips enabled and updates the live registry', async () => {
  const ctx = await startTestServer();
  try {
    const created = await (await fetch(`${ctx.base}/provider-registry`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Toggle Me', protocol: 'ollama', base_url: 'http://127.0.0.1:1', enabled: true }),
    })).json();
    assert.ok(ctx.jarvis.registry.get(created.id), 'enabled provider should be loaded into the live registry');

    const toggleRes = await fetch(`${ctx.base}/provider-registry/${created.id}/toggle`, { method: 'POST' });
    assert.equal(toggleRes.status, 200);
    assert.equal((await toggleRes.json()).enabled, false);
    assert.equal(ctx.jarvis.registry.get(created.id), null, 'disabled provider should drop out of the live registry');
  } finally {
    await ctx.close();
  }
});

test('POST /api/provider-registry/:id/toggle 404s for an unknown id', async () => {
  const ctx = await startTestServer();
  try {
    const res = await fetch(`${ctx.base}/provider-registry/does-not-exist/toggle`, { method: 'POST' });
    assert.equal(res.status, 404);
  } finally {
    await ctx.close();
  }
});

test('POST /api/provider-registry/:id/test reports unreachable providers without throwing', async () => {
  const ctx = await startTestServer();
  try {
    const created = await (await fetch(`${ctx.base}/provider-registry`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Unreachable', protocol: 'ollama', base_url: 'http://127.0.0.1:1' }),
    })).json();

    const testRes = await fetch(`${ctx.base}/provider-registry/${created.id}/test`, { method: 'POST' });
    assert.equal(testRes.status, 200);
    const body = await testRes.json();
    assert.equal(body.available, false);
    assert.ok(body.reason);
    assert.equal(typeof body.latencyMs, 'number');
  } finally {
    await ctx.close();
  }
});

test('GET /api/settings/effective folds provider/model/orchestration state into one object', async () => {
  const ctx = await startTestServer();
  try {
    const res = await fetch(`${ctx.base}/settings/effective`);
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const key of ['activeProvider', 'activeModel', 'cloudConfigured', 'activeProviderLabel', 'isCloudProvider', 'mode', 'autoEscalateRules']) {
      assert.ok(key in body, `settings() response should include ${key}`);
    }
  } finally {
    await ctx.close();
  }
});
