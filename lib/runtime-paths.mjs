import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The installation directory (this file lives at <root>/lib/runtime-paths.mjs),
// resolved from this file's own location rather than process.cwd() — the daemon,
// CLI, and desktop host can all be launched from any working directory.
export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Accepts absolute (Windows or POSIX), relative, and tilde-prefixed paths.
export function resolveRuntimePath(rawPath, fallback) {
  if (!rawPath || !String(rawPath).trim()) return fallback;
  return path.resolve(String(rawPath).replace(/^~(?=[/\\]|$)/, os.homedir()));
}

export class RuntimePathError extends Error {
  constructor(key, location, operation, cause) {
    super(`Could not ${operation} ${key} at ${location}: ${cause?.message || cause}`);
    this.name = 'RuntimePathError';
    this.code = 'runtime_path';
    this.key = key;
    this.location = location;
    this.operation = operation;
  }
}

const DIRECTORY_KEYS = ['dataRoot', 'cacheRoot', 'tempRoot', 'modelRoot', 'profileRoot', 'sessionRoot', 'logRoot', 'crashRoot'];

/**
 * Resolve every runtime location under one root. The caller owns where that root
 * is: source execution passes the installation directory, and the desktop host
 * passes the root it discovers for a packaged application.
 */
export function createRuntimePaths({ root = PROJECT_ROOT, env = process.env } = {}) {
  const dataRoot = resolveRuntimePath(env.JARVIS_DATA_DIR, path.join(root, 'data'));
  const cacheRoot = path.join(root, 'cache');
  const electronCache = path.join(cacheRoot, 'electron');
  return Object.freeze({
    root,
    dataRoot,
    cacheRoot,
    tempRoot: resolveRuntimePath(env.JARVIS_TEMP_DIR, path.join(cacheRoot, 'temp')),
    modelRoot: resolveRuntimePath(env.JARVIS_MODEL_DIR, path.join(root, 'models')),
    profileRoot: path.join(dataRoot, 'electron-profile'),
    sessionRoot: path.join(electronCache, 'session'),
    logRoot: path.join(electronCache, 'logs'),
    crashRoot: path.join(electronCache, 'crash-dumps'),
    agentConfigPath: path.join(dataRoot, 'agents.json'),
    databasePath: path.join(dataRoot, 'sql-db', 'jarvis.sqlite'),
    discoveryPath: path.join(dataRoot, 'daemon.json'),
    lockPath: path.join(dataRoot, 'daemon.lock'),
    providerKeyPath: path.join(dataRoot, 'provider.key'),
  });
}

// A failure names the logical path, the resolved location, and the operation, so
// an unwritable destination is reported rather than silently relocated.
export function ensureRuntimePaths(paths) {
  for (const key of DIRECTORY_KEYS) {
    const location = paths[key];
    try { fs.mkdirSync(location, { recursive: true }); }
    catch (error) { throw new RuntimePathError(key, location, 'create', error); }
  }
  try { fs.accessSync(paths.dataRoot, fs.constants.W_OK); }
  catch (error) { throw new RuntimePathError('dataRoot', paths.dataRoot, 'write to', error); }
  return paths;
}
