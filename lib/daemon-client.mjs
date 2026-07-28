import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory } from './database.mjs';

const discoveryFile = path.join(dataDirectory(), 'daemon.json');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export class DaemonClient {
  constructor(discovery) { this.discovery = discovery; this.base = `http://127.0.0.1:${discovery.port}/api`; }
  static async connect({ start = true } = {}) {
    let discovery = await readDiscovery();
    if (!discovery || !(await healthy(discovery))) {
      if (!start) throw new Error('JARVIS daemon is not running.');
      await startDaemon(); discovery = await waitForDiscovery();
    }
    return new DaemonClient(discovery);
  }
  async json(route, options = {}) {
    const response = await fetch(`${this.base}${route}`, { ...options, headers: { 'content-type': 'application/json', 'x-jarvis-token': this.discovery.token, ...options.headers } });
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `Request failed (${response.status})`); }
    return response.status === 204 ? undefined : response.json();
  }
  health() { return this.json('/health'); } conversations() { return this.json('/conversations'); } conversation(id) { return this.json(`/conversations/${id}`); }
  createConversation(title) { return this.json('/conversations', { method: 'POST', body: JSON.stringify({ title }) }); }
  providers() { return this.json('/providers'); } diagnostics() { return this.json('/diagnostics'); } voice() { return this.json('/voice'); }
  cancel(id) { return this.json(`/chat/${id}/cancel`, { method: 'POST', body: '{}' }); }
  setProvider(provider) { return this.json('/settings/active-provider', { method: 'POST', body: JSON.stringify({ provider }) }); }
  setModel(provider, model) { return this.json('/settings/model', { method: 'POST', body: JSON.stringify({ provider, model }) }); }
  setVoice(voice) { return this.json('/voice/voice', { method: 'POST', body: JSON.stringify({ voice }) }); }
  setListening(enabled) { return this.json('/voice/enabled', { method: 'POST', body: JSON.stringify({ enabled }) }); }
  async *events(signal) {
    const response = await fetch(`${this.base}/events`, { headers: { 'x-jarvis-token': this.discovery.token }, signal });
    if (!response.ok || !response.body) throw new Error('Unable to open assistant event stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) { const { value, done } = await reader.read(); if (done) return; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() || ''; for (const frame of frames) { const data = frame.split('\n').find((line) => line.startsWith('data:')); if (data) yield JSON.parse(data.slice(5)); } }
  }
  async *chat(payload) {
    const response = await fetch(`${this.base}/chat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis-token': this.discovery.token }, body: JSON.stringify(payload) });
    if (!response.ok || !response.body) throw new Error('Unable to open assistant stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) { const { value, done } = await reader.read(); if (done) return; buffer += decoder.decode(value, { stream: true }); const frames = buffer.split('\n\n'); buffer = frames.pop() || ''; for (const frame of frames) { const data = frame.split('\n').find((line) => line.startsWith('data:')); if (data) yield JSON.parse(data.slice(5)); } }
  }
}

async function readDiscovery() { try { return JSON.parse(await fs.readFile(discoveryFile, 'utf8')); } catch { return null; } }
async function healthy(discovery) { try { const response = await fetch(`http://127.0.0.1:${discovery.port}/api/health`, { headers: { 'x-jarvis-token': discovery.token }, signal: AbortSignal.timeout(500) }); return response.ok; } catch { return false; } }
async function startDaemon() { const electron = path.join(root, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'); try { await fs.access(electron); const child = spawn(electron, ['.', '--jarvis-daemon'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); return; } catch {} const child = spawn(process.execPath, [path.join(root, 'daemon.mjs')], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); }
async function waitForDiscovery() { for (let attempt = 0; attempt < 30; attempt += 1) { await new Promise((resolve) => setTimeout(resolve, 200)); const discovery = await readDiscovery(); if (discovery && await healthy(discovery)) return discovery; } throw new Error('JARVIS daemon did not become ready.'); }
