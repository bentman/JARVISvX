import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { UnauthorizedRelocationError, migrateDataDirectory, wouldRelocate } from './data-migration.mjs';
import { assertCredentialKeyAvailable } from './database.mjs';
import { createJarvisApp } from './application.mjs';
import { createApiRouter } from './api.mjs';
import { createRuntimePaths, ensureRuntimePaths } from './runtime-paths.mjs';

// Immutable assets ship with the code; every mutable location comes from the
// resolved path set instead.
const codeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Identifies this process to a contender inspecting the lock it left behind.
const INSTANCE_ID = crypto.randomUUID();

export const LIFECYCLE_STATES = ['starting', 'ready', 'degraded', 'stopping'];

export async function startDaemon({ port = Number(process.env.JARVIS_PORT || 3210), token = crypto.randomBytes(32).toString('hex'), paths = createRuntimePaths(), onMigrationConflict, voiceManifest, env = process.env } = {}) {
  // One migration owns the move, before anything opens the destination. Moving
  // the operator's directory is a deliberate act: a host that can ask does, and
  // every other caller needs JARVIS_DATA_MIGRATE, so a stray environment
  // variable cannot relocate durable state as a side effect of another run.
  const legacyRoot = path.join(paths.root, 'data');
  if (!onMigrationConflict && env.JARVIS_DATA_MIGRATE !== '1' && await wouldRelocate(legacyRoot, paths.dataRoot)) {
    throw new UnauthorizedRelocationError(legacyRoot, paths.dataRoot);
  }
  await migrateDataDirectory(legacyRoot, paths.dataRoot, { prompt: onMigrationConflict });
  ensureRuntimePaths(paths);
  assertCredentialKeyAvailable(paths.dataRoot);
  const lock = await acquireLock(paths);

  // Ownership is held from here on, so every failure path unwinds through the
  // same teardown rather than leaving the lock behind.
  let lifecycle = 'starting';
  let jarvis;
  let server;
  const opened = [];
  const teardown = async () => {
    lifecycle = 'stopping';
    for (const release of opened.reverse()) await release().catch(() => {});
    await lock.close();
  };

  try {
    jarvis = createJarvisApp({ paths, voiceManifest });
    opened.push(async () => jarvis.db.close());

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '128kb' }));
    app.use('/api', createApiRouter(jarvis, { token, lifecycle: () => lifecycle }));
    // The ownership probe answers in every lifecycle state; a contender uses it
    // to tell a live owner from a stale lock, not to decide readiness.
    app.get('/daemon/status', (req, res) => (req.get('x-jarvis-token') === token
      ? res.json({ status: lifecycle, pid: process.pid, instance: INSTANCE_ID })
      : res.status(401).json({ error: 'Daemon authentication required.', code: 'unauthorized' })));
    app.use(express.static(path.join(codeRoot, 'dist')));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(codeRoot, 'dist', 'index.html')));

    server = http.createServer(app);
    try { await listen(server, port); } catch (error) { if (error.code !== 'EADDRINUSE' || process.env.JARVIS_PORT) throw error; await listen(server, 0); }
    opened.push(() => new Promise((resolve) => server.close(resolve)));

    const actualPort = server.address().port;
    await fsp.writeFile(paths.discoveryPath, JSON.stringify({ port: actualPort, token, pid: process.pid, instance: INSTANCE_ID, startedAt: new Date().toISOString() }, null, 2));
    opened.push(() => fsp.unlink(paths.discoveryPath).catch(() => {}));

    // Core services gate readiness; voice-model acquisition does not.
    await jarvis.initializeCore();
    const voiceReady = jarvis.startVoiceBootstrap().then(() => { if (lifecycle === 'degraded') lifecycle = 'ready'; });
    lifecycle = jarvis.voice.isReady() ? 'ready' : 'degraded';

    // Shutdown waits for voice acquisition to settle. Bootstrap writes into the
    // model root, so returning from close() while an install is in flight would
    // leave a partial file behind and race any caller that clears the data root
    // next. The promise never rejects, so this cannot turn shutdown into a throw.
    const close = async () => {
      await voiceReady.catch(() => {});
      await teardown();
      await fsp.unlink(paths.lockPath).catch(() => {});
    };
    return { app, server, jarvis, paths, port: actualPort, token, voiceReady, close, lifecycle: () => lifecycle };
  } catch (error) {
    await teardown();
    await fsp.unlink(paths.lockPath).catch(() => {});
    throw error;
  }
}


export async function daemonDiscovery(paths = createRuntimePaths()) { try { return JSON.parse(await fsp.readFile(paths.discoveryPath, 'utf8')); } catch { return null; } }
// The record is written by the same atomic call that creates the lock, so a
// contender never inspects a lock that has no owner in it.
async function acquireLock(paths) {
  const record = JSON.stringify({ pid: process.pid, instance: INSTANCE_ID, createdAt: new Date().toISOString() });
  const take = async () => {
    await fsp.writeFile(paths.lockPath, record, { flag: 'wx' });
    return { close: async () => {} };
  };

  try {
    return await take();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (await lockIsHeld(paths)) throw new Error('JARVIS daemon is already running.');
    await fsp.unlink(paths.lockPath).catch(() => {});
    return take();
  }
}

/**
 * Whether the existing lock still belongs to a living owner.
 *
 * A lock is released only on positive evidence that its owner is gone: the
 * recorded process is absent and no instance answers the ownership probe as
 * that owner. An unreadable lock and missing discovery are both absences of
 * evidence, so neither releases it.
 */
async function lockIsHeld(paths) {
  const owner = await readLockRecord(paths);
  if (!owner) return true;
  if (owner.pid && isPidAlive(owner.pid)) return true;
  return respondsAsOwner(await daemonDiscovery(paths), owner);
}

async function readLockRecord(paths) {
  try {
    const record = JSON.parse(await fsp.readFile(paths.lockPath, 'utf8'));
    return record && typeof record === 'object' && record.pid ? record : null;
  } catch {
    return null;
  }
}

// Any lifecycle state proves ownership; only an answer from the recorded
// instance counts, so an unrelated listener on the port cannot hold the lock.
async function respondsAsOwner(discovery, owner) {
  if (!discovery?.port || !discovery.token) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${discovery.port}/daemon/status`, {
      headers: { 'x-jarvis-token': discovery.token },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const status = await response.json();
    return status.pid === owner.pid && status.instance === owner.instance && LIFECYCLE_STATES.includes(status.status);
  } catch {
    return false;
  }
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function listen(server, port) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }

