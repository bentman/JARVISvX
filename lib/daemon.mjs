import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { migrateDataDirectory } from './data-migration.mjs';
import { assertCredentialKeyAvailable } from './database.mjs';
import { createJarvisApp } from './application.mjs';
import { createApiRouter } from './api.mjs';
import { createRuntimePaths, ensureRuntimePaths } from './runtime-paths.mjs';

// Immutable assets ship with the code; every mutable location comes from the
// resolved path set instead.
const codeRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function startDaemon({ port = Number(process.env.JARVIS_PORT || 3210), token = crypto.randomBytes(32).toString('hex'), paths = createRuntimePaths(), onMigrationConflict } = {}) {
  // One migration owns the move, before anything opens the destination.
  await migrateDataDirectory(path.join(paths.root, 'data'), paths.dataRoot, { prompt: onMigrationConflict });
  ensureRuntimePaths(paths);
  assertCredentialKeyAvailable(paths.dataRoot);
  const lock = await acquireLock(paths);
  const jarvis = createJarvisApp({ paths });
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '128kb' })); app.get('/daemon/status', (_req, res) => res.json({ status: 'ready', pid: process.pid })); app.use('/api', createApiRouter(jarvis, { token }));
  app.use(express.static(path.join(codeRoot, 'dist'))); app.get('/{*splat}', (_req, res) => res.sendFile(path.join(codeRoot, 'dist', 'index.html')));
  const server = http.createServer(app);
  try { await listen(server, port); } catch (error) { if (error.code !== 'EADDRINUSE' || process.env.JARVIS_PORT) throw error; await listen(server, 0); }
  const actualPort = server.address().port; await fsp.writeFile(paths.discoveryPath, JSON.stringify({ port: actualPort, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  await jarvis.initialize();
  const close = async () => { await new Promise((resolve) => server.close(resolve)); jarvis.db.close(); await lock.close(); await Promise.allSettled([fsp.unlink(paths.discoveryPath), fsp.unlink(paths.lockPath)]); };
  return { app, server, jarvis, paths, port: actualPort, token, close };
}


export async function daemonDiscovery(paths = createRuntimePaths()) { try { return JSON.parse(await fsp.readFile(paths.discoveryPath, 'utf8')); } catch { return null; } }
async function acquireLock(paths) {
  const lock = paths.lockPath;
  try {
    return await fsp.open(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await daemonDiscovery(paths);
    if (existing && await alive(existing)) throw new Error('JARVIS daemon is already running.');
    if (existing?.pid && isPidAlive(existing.pid)) throw new Error('JARVIS daemon is already running.');
    await fsp.unlink(lock).catch(() => {});
    return fsp.open(lock, 'wx');
  }
}
async function alive({ port, token }) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'x-jarvis-token': token }, signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch { return false; }
}
function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function listen(server, port) { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }

