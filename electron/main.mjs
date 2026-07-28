import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDaemon, daemonDiscovery } from '../lib/daemon.mjs';
import { DaemonClient } from '../lib/daemon-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const electronProfile = path.join(projectRoot, 'data', 'electron-profile');
const electronCache = path.join(projectRoot, 'cache', 'electron');
const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
const iconPath = app.isPackaged ? path.join(process.resourcesPath, iconFile) : path.join(projectRoot, 'src', 'icon', iconFile);
// Electron otherwise creates its Chromium profile under the user's home/AppData.
// Durable preferences live in data; recreatable Chromium state lives in cache.
app.setPath('userData', electronProfile);
app.setPath('sessionData', path.join(electronCache, 'session'));
app.setPath('logs', path.join(electronCache, 'logs'));
app.setPath('crashDumps', path.join(electronCache, 'crash-dumps'));
let window; let tray; let daemon; let quitting = false;
const headlessVoiceHost = process.argv.includes('--jarvis-daemon');
const createWindow = async () => {
  const discovery = daemon || await daemonDiscovery();
  window = new BrowserWindow({ width: 1220, height: 820, minWidth: 900, minHeight: 650, show: false, icon: iconPath, webPreferences: { preload: path.join(here, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window.hide(); } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(`[renderer] ${message}`); });
  if (!headlessVoiceHost) window.once('ready-to-show', () => window.show());
  await window.loadURL(`http://127.0.0.1:${discovery.port}/?daemon=${encodeURIComponent(JSON.stringify({ port: discovery.port, token: discovery.token }))}`);
};
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'media' && contents.getURL().startsWith('http://127.0.0.1:')));
  try { daemon = await startDaemon(); } catch (error) {
    const existing = await daemonDiscovery();
    if (!existing) throw error;
    try { await new DaemonClient(existing).health(); daemon = existing; } catch { throw error; }
  }
  await createWindow();
  const icon = nativeImage.createFromPath(iconPath); tray = new Tray(icon); tray.setToolTip('JARVISvX — voice host'); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show JARVIS', click: () => window.show() }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }])); tray.on('click', () => window.show());
  ipcMain.handle('jarvis:daemon', () => ({ port: daemon.port, token: daemon.token }));
  ipcMain.handle('jarvis:voice', async (_event, action, payload) => { const client = await DaemonClient.connect(); if (action === 'status') return client.voice(); if (action === 'listen') return client.setListening(payload); if (action === 'voice') return client.setVoice(payload); if (action === 'bootstrap') return client.json(`/voice/bootstrap/${payload}`, { method: 'POST', body: '{}' }); throw new Error('Unknown voice action.'); });
});
app.on('before-quit', async () => { quitting = true; if (daemon?.close) await daemon.close(); });
app.on('window-all-closed', (event) => event.preventDefault());
