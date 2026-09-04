import 'dotenv/config';
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session, dialog } from 'electron';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { startDaemon, daemonDiscovery } from '../lib/daemon.mjs';
import { DaemonClient } from '../lib/daemon-client.mjs';
import { createRuntimePaths, ensureRuntimePaths } from '../lib/runtime-paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
// A packaged application keeps runtime state beside its executable; the source
// tree keeps it beside the project. Neither resolves inside the ASAR archive.
const paths = createRuntimePaths({ root: app.isPackaged ? path.dirname(app.getPath('exe')) : projectRoot });
ensureRuntimePaths(paths);
const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
const iconPath = app.isPackaged ? path.join(process.resourcesPath, iconFile) : path.join(projectRoot, 'src', 'icon', iconFile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox');
  try { execFileSync('icacls', [paths.cacheRoot, '/grant', '*S-1-15-2-1:(OI)(CI)F', '/T', '/Q'], { stdio: 'ignore' }); } catch {}
}
// Durable preferences live in data; recreatable Chromium state lives in cache.
app.setPath('userData', paths.profileRoot);
app.setPath('sessionData', paths.sessionRoot);
app.setPath('logs', paths.logRoot);
app.setPath('crashDumps', paths.crashRoot);
let window; let tray; let daemon; let quitting = false;

let ttsWorker; let ttsId = 0; let ttsQueue = Promise.resolve(); const ttsPending = new Map();
const headlessVoiceHost = process.argv.includes('--jarvis-daemon');
// Configuration the host cannot work around: attaching to another instance or
// retrying reaches the same refusal, so these end the run with their message.
const FATAL_STARTUP_CODES = new Set(['unsupported_storage']);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
});
const createWindow = async () => {
  const discovery = daemon || await daemonDiscovery(paths);
  window = new BrowserWindow({ width: 1220, height: 820, minWidth: 900, minHeight: 650, show: false, icon: iconPath, webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, autoplayPolicy: 'no-user-gesture-required' } });
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.on('console-message', (event, ...args) => {
    const level = typeof event?.level === 'number' ? event.level : (typeof args[0] === 'number' ? args[0] : args[0]?.level ?? 0);
    const message = event?.message ?? (typeof args[0] === 'number' ? args[1] : args[0]?.message ?? String(event));
    if (level >= 2) console.error(`[renderer] ${message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) => console.error(`[renderer-crash] ${details.reason}; exitCode=${details.exitCode}`));
  window.webContents.on('unresponsive', () => console.error('[renderer-crash] renderer became unresponsive'));
  if (!headlessVoiceHost) window.once('ready-to-show', () => window.show());
  await window.loadURL(`http://127.0.0.1:${discovery.port}/`);
};
app.whenReady().then(async () => {
  ensureRuntimePaths(paths);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media' && contents.getURL().startsWith('http://127.0.0.1:')));
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => permission === 'media' && requestingOrigin.startsWith('http://127.0.0.1:'));

  // The desktop host resolves migration conflicts interactively; the daemon owns
  // the single migration invocation.
  const onMigrationConflict = async ({ target }) => {
    if (headlessVoiceHost) return 'import';
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'JARVIS Data Directory',
      message: 'Data found in both locations',
      detail: `Existing data detected at the configured destination:\n\n${target}\n\nChoose how to proceed:`,
      buttons: ['Import existing data (safe merge)', 'Start fresh at destination (overwrite)', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (response === 2) { app.quit(); process.exit(0); }
    return response === 1 ? 'overwrite' : 'import';
  };

  // A startup failure the operator has to resolve carries its remedy in the
  // message, so it is shown and the host exits rather than raised into a stack
  // trace the desktop never displays.
  const failStartup = (error) => {
    if (headlessVoiceHost) console.error(error.message);
    else dialog.showErrorBox('JARVIS cannot start', error.message);
    app.quit();
    process.exit(1);
  };

  try { daemon = await startDaemon({ paths, onMigrationConflict }); } catch (error) {
    if (FATAL_STARTUP_CODES.has(error.code)) failStartup(error);
    const existing = await daemonDiscovery(paths);
    if (!existing) throw error;
    try { await new DaemonClient(existing).health(); daemon = existing; } catch { throw error; }
  }
  await createWindow();

  const icon = nativeImage.createFromPath(iconPath); tray = new Tray(icon); tray.setToolTip('JARVISvX — voice host'); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show JARVIS', click: () => window.show() }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }])); tray.on('click', () => window.show());
  ipcMain.handle('jarvis:daemon', () => ({ port: daemon.port, token: daemon.token }));
  ipcMain.handle('jarvis:tts', (event, action, payload = {}) => {
    if (action === 'cancel') { const worker = ttsWorker; ttsWorker = undefined; ttsQueue = Promise.resolve(); for (const { resolve } of ttsPending.values()) resolve({ ok: false, cancelled: true, error: 'Local Kokoro synthesis cancelled.', sampleRate: 24_000, samples: new Float32Array() }); ttsPending.clear(); return worker?.terminate(); }
    if (action !== 'synthesize') return { ok: false, error: 'Unknown local TTS action.', sampleRate: 24_000, samples: new Float32Array() }; const id = ++ttsId;
    const warmup = !String(payload.text || '').trim();
    const run = () => new Promise((resolve, reject) => {
      const worker = getTtsWorker();
      const sendProgress = (stage, message, extra = {}) => event.sender.send('jarvis:tts-progress', { id, stage, message, ...extra });
      const timer = setTimeout(() => { ttsPending.delete(id); sendProgress('timeout', 'Local Kokoro synthesis timed out.'); const stuck = ttsWorker; ttsWorker = undefined; void stuck?.terminate(); resolve({ ok: false, stage: 'timeout', error: 'Local Kokoro synthesis timed out.', sampleRate: 24_000, samples: new Float32Array() }); }, 90_000);
      ttsPending.set(id, { sender: event.sender, progress: sendProgress, resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      worker.postMessage({ id, modelPath: path.join(paths.modelRoot, 'tts', 'kokoro-v1', 'kokoro-v1.0.onnx'), voicesPath: path.join(paths.modelRoot, 'tts', 'kokoro-v1', 'voices-v1.0.bin'), text: String(payload.text || ''), voice: String(payload.voice || 'bf_isabella') });
    });
    if (warmup) return run();
    const request = ttsQueue.then(run, run);
    ttsQueue = request.catch(() => {});
    return request;
  });
  ipcMain.handle('jarvis:voice', async (_event, action, payload) => { const client = await DaemonClient.connect(); if (action === 'status') return client.voice(); if (action === 'listen') return client.setListening(payload); if (action === 'voice') return client.setVoice(payload); if (action === 'bootstrap') return client.json(`/voice/bootstrap/${payload}`, { method: 'POST', body: '{}' }); throw new Error('Unknown voice action.'); });
});
app.on('before-quit', async () => { quitting = true; if (daemon?.close) await daemon.close(); });
app.on('window-all-closed', (event) => event.preventDefault());
function getTtsWorker() {
  if (ttsWorker) return ttsWorker;
  const worker = new Worker(path.join(here, 'kokoro-onnx-worker.mjs')); ttsWorker = worker;
  worker.on('message', (message) => { const pending = ttsPending.get(message.id); if (!pending) return; if (message.type === 'progress') { pending.progress?.(message.stage, message.message, message); return; } ttsPending.delete(message.id); pending.resolve(message); });
  worker.on('error', (error) => { if (ttsWorker !== worker) return; for (const { resolve, progress } of ttsPending.values()) { progress?.('worker-error', error.message || String(error)); resolve({ ok: false, stage: 'worker-error', error: error.message || String(error), sampleRate: 24_000, samples: new Float32Array() }); } ttsPending.clear(); });
  worker.on('exit', (code) => { if (ttsWorker !== worker) return; for (const { resolve, progress } of ttsPending.values()) { progress?.('worker-exit', `Local Kokoro worker exited (${code}).`); resolve({ ok: false, stage: 'worker-exit', error: `Local Kokoro worker exited (${code}).`, sampleRate: 24_000, samples: new Float32Array() }); } ttsPending.clear(); ttsWorker = undefined; });
  return worker;
}

