import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { dataDirectory } from './database.mjs';
import { createJarvisApp } from './application.mjs';
import { createApiRouter } from './api.mjs';

const discoveryPath = () => path.join(dataDirectory(), 'daemon.json');
const lockPath = () => path.join(dataDirectory(), 'daemon.lock');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export async function startDaemon({ port = Number(process.env.JARVIS_PORT || 3210), token = crypto.randomBytes(32).toString('hex') } = {}) {
  fs.mkdirSync(dataDirectory(), { recursive: true });
  const lock = await acquireLock();
  const jarvis = createJarvisApp();
  const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '128kb' })); app.get('/daemon/status', (_req, res) => res.json({ status: 'ready', pid: process.pid })); app.use('/api', createApiRouter(jarvis, { token }));
  app.use(express.static(path.join(root, 'dist'))); app.get('/{*splat}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  const server = http.createServer(app);
  try { await listen(server, port); } catch (error) { if (error.code !== 'EADDRINUSE' || process.env.JARVIS_PORT) throw error; await listen(server, 0); }
  const actualPort = server.address().port; await fsp.writeFile(discoveryPath(), JSON.stringify({ port: actualPort, token, pid: process.pid, startedAt: new Date().toISOString() }, null, 2));
  await jarvis.initialize();
  const close = async () => { await new Promise((resolve) => server.close(resolve)); jarvis.db.close(); await lock.close(); await Promise.allSettled([fsp.unlink(discoveryPath()), fsp.unlink(lockPath())]); };
  return { app, server, jarvis, port: actualPort, token, close };
}

export async function daemonDiscovery() { try { return JSON.parse(await fsp.readFile(discoveryPath(), 'utf8')); } catch { return null; } }
async function acquireLock() {
  const lock = lockPath();
  try {
    return await fsp.open(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await daemonDiscovery();
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
