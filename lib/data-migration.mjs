/**
 * Data directory migration.
 *
 * Moves JARVIS durable state from one directory to another, matching the
 * same path-resolution semantics as workspace roots (any valid filesystem
 * path: absolute, relative, tilde-prefixed).
 *
 * Conflict resolution when data already exists at the target:
 *   'import'    - merge: copy any target-only files back into source, then
 *                 move source to target (source files win on conflict).
 *   'overwrite' - delete target contents, then move source to target.
 *
 * In non-interactive contexts (daemon / CLI) the prompt callback is never
 * called and the safe, non-destructive 'import' applies. A prompt that resolves
 * to anything other than 'import' or 'overwrite' raises MigrationConflictError
 * and leaves both directories untouched.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';

export class MigrationConflictError extends Error {
  constructor(source, target) {
    super(`Data exists at both ${source} and ${target}. Resolve the conflict before starting, or choose import or overwrite.`);
    this.name = 'MigrationConflictError';
    this.code = 'migration_conflict';
    this.source = source;
    this.target = target;
  }
}

/**
 * Migrate data from sourceDir to targetDir.
 *
 * @param {string} sourceDir  Fully-resolved source path (default ./data).
 * @param {string} targetDir  Fully-resolved target path from JARVIS_DATA_DIR.
 * @param {object} [options]
 * @param {Function} [options.prompt]  Async fn({ source, target }) -> 'import' | 'overwrite'.
 *                                     When omitted the safe default ('import') is used.
 * @returns {Promise<{ action: 'created'|'moved'|'skipped', source: string, target: string }>}
 */
export async function migrateDataDirectory(sourceDir, targetDir, { prompt } = {}) {
  const src = path.resolve(sourceDir);
  const dst = path.resolve(targetDir);

  if (src === dst) return { action: 'skipped', source: src, target: dst };

  const srcExists = await dirExists(src);
  const dstExists = await dirExists(dst);

  if (!srcExists) {
    await fsp.mkdir(dst, { recursive: true });
    return { action: 'created', source: src, target: dst };
  }

  if (dstExists && await dirHasContents(dst)) {
    const choice = prompt ? await prompt({ source: src, target: dst }) : 'import';
    if (choice !== 'import' && choice !== 'overwrite') throw new MigrationConflictError(src, dst);

    if (choice === 'overwrite') {
      await fsp.rm(dst, { recursive: true, force: true });
    } else {
      // 'import': merge target-only files into source (source wins on conflict),
      // then clear target so move can proceed.
      await mergeInto(dst, src);
      await fsp.rm(dst, { recursive: true, force: true });
    }
  }

  await moveDirectory(src, dst);
  return { action: 'moved', source: src, target: dst };
}

/**
 * Expose the active data directory through the same app-surface shape as
 * workspace roots, so callers (API, UI) can display and reason about it.
 *
 * @param {string} resolvedPath  The fully-resolved dataDirectory() value.
 * @returns {{ id: string, path: string, label: string, editable: boolean }}
 */
export function dataDirectoryInfo(resolvedPath) {
  return {
    id: 'data-dir',
    path: resolvedPath,
    label: 'Data Directory',
    editable: false,
  };
}

// ---------------------------------------------------------------------------

async function dirExists(dir) {
  try { return (await fsp.stat(dir)).isDirectory(); } catch { return false; }
}

async function dirHasContents(dir) {
  try { return (await fsp.readdir(dir)).length > 0; } catch { return false; }
}

async function mergeInto(from, to) {
  await fsp.mkdir(to, { recursive: true });
  const entries = await fsp.readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(from, entry.name);
    const dstPath = path.join(to, entry.name);
    const dstPresent = await fsp.stat(dstPath).then(() => true, () => false);
    if (dstPresent) continue;
    if (entry.isDirectory()) {
      await mergeInto(srcPath, dstPath);
    } else {
      await fsp.mkdir(path.dirname(dstPath), { recursive: true });
      await fsp.copyFile(srcPath, dstPath);
    }
  }
}

async function moveDirectory(src, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  try {
    await fsp.rename(src, dst);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await copyDirectory(src, dst);
    await fsp.rm(src, { recursive: true, force: true });
  }
}

async function copyDirectory(src, dst) {
  await fsp.mkdir(dst, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(srcPath, dstPath);
    } else {
      await fsp.mkdir(path.dirname(dstPath), { recursive: true });
      await fsp.copyFile(srcPath, dstPath);
    }
  }
}
