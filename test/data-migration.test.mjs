import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveDataDirectory, PROJECT_ROOT } from '../lib/database.mjs';
import { migrateDataDirectory, dataDirectoryInfo } from '../lib/data-migration.mjs';

// ---------------------------------------------------------------------------
// resolveDataDirectory — path resolution
// ---------------------------------------------------------------------------

test('resolveDataDirectory defaults to <project-root>/data when env is empty', () => {
  const result = resolveDataDirectory('');
  assert.equal(result, path.join(PROJECT_ROOT, 'data'));
});

// Regression test for: running the daemon via the globally-linked `jarvis` CLI
// (or any other cwd) must not scatter data into the user's current directory —
// the default has to be anchored to the project install, not process.cwd().
test('resolveDataDirectory default does not depend on the current working directory', () => {
  const originalCwd = process.cwd();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cwd-probe-'));
  try {
    process.chdir(elsewhere);
    const result = resolveDataDirectory('');
    assert.equal(result, path.join(PROJECT_ROOT, 'data'));
    assert.notEqual(result, path.resolve('data'), 'default data dir must not be resolved against cwd');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('resolveDataDirectory resolves absolute path unchanged', () => {
  const abs = process.platform === 'win32' ? 'E:\\ProgramData\\.jarvis\\data' : '/var/lib/jarvis/data';
  const result = resolveDataDirectory(abs);
  assert.equal(result, path.resolve(abs));
});

test('resolveDataDirectory expands leading tilde on any platform', () => {
  const result = resolveDataDirectory('~/.jarvis/data');
  const expected = path.join(os.homedir(), '.jarvis', 'data');
  assert.equal(result, expected);
});

test('resolveDataDirectory resolves relative path against cwd', () => {
  const result = resolveDataDirectory('./custom/data');
  assert.equal(result, path.resolve('./custom/data'));
});

// ---------------------------------------------------------------------------
// dataDirectoryInfo — surface shape matches workspace-roots
// ---------------------------------------------------------------------------

test('dataDirectoryInfo returns correct surface shape', () => {
  const info = dataDirectoryInfo('/some/path/data');
  assert.equal(info.id, 'data-dir');
  assert.equal(info.path, '/some/path/data');
  assert.equal(info.label, 'Data Directory');
  assert.equal(info.editable, false);
});

// ---------------------------------------------------------------------------
// migrateDataDirectory — filesystem operations
// ---------------------------------------------------------------------------

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-mig-')); }

test('migration creates target when source is absent', async () => {
  const base = tmpDir();
  const src = path.join(base, 'src');   // does not exist
  const dst = path.join(base, 'dst');
  const result = await migrateDataDirectory(src, dst);
  assert.equal(result.action, 'created');
  assert.ok(fs.existsSync(dst));
  fs.rmSync(base, { recursive: true, force: true });
});

test('migration returns skipped when source and target are the same path', async () => {
  const base = tmpDir();
  const result = await migrateDataDirectory(base, base);
  assert.equal(result.action, 'skipped');
  fs.rmSync(base, { recursive: true, force: true });
});

test('migration moves source to empty target', async () => {
  const base = tmpDir();
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, 'jarvis.sqlite'), 'fake-db');
  const result = await migrateDataDirectory(src, dst);
  assert.equal(result.action, 'moved');
  assert.ok(fs.existsSync(path.join(dst, 'jarvis.sqlite')));
  assert.ok(!fs.existsSync(src));
  fs.rmSync(base, { recursive: true, force: true });
});

test('migration with overwrite clears target then moves source', async () => {
  const base = tmpDir();
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(src, 'new.sqlite'), 'new');
  fs.writeFileSync(path.join(dst, 'old.sqlite'), 'old');
  let promptCalled = false;
  const result = await migrateDataDirectory(src, dst, {
    prompt: async () => { promptCalled = true; return 'overwrite'; },
  });
  assert.equal(result.action, 'moved');
  assert.ok(promptCalled, 'prompt should be called when target has data');
  assert.ok(fs.existsSync(path.join(dst, 'new.sqlite')));
  assert.ok(!fs.existsSync(path.join(dst, 'old.sqlite')), 'old target file should be gone after overwrite');
  fs.rmSync(base, { recursive: true, force: true });
});

test('migration with import merges target-only files into source, source wins on conflict', async () => {
  const base = tmpDir();
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
  // Source has 'jarvis.sqlite'; target has 'extra.txt' and its own 'jarvis.sqlite'
  fs.writeFileSync(path.join(src, 'jarvis.sqlite'), 'source-db');
  fs.writeFileSync(path.join(dst, 'jarvis.sqlite'), 'target-db');
  fs.writeFileSync(path.join(dst, 'extra.txt'), 'target-only');
  const result = await migrateDataDirectory(src, dst, {
    prompt: async () => 'import',
  });
  assert.equal(result.action, 'moved');
  // Source's jarvis.sqlite wins
  assert.equal(fs.readFileSync(path.join(dst, 'jarvis.sqlite'), 'utf8'), 'source-db');
  // Target-only file survives
  assert.equal(fs.readFileSync(path.join(dst, 'extra.txt'), 'utf8'), 'target-only');
  fs.rmSync(base, { recursive: true, force: true });
});

test('non-interactive migration defaults to import when no prompt provided', async () => {
  const base = tmpDir();
  const src = path.join(base, 'src');
  const dst = path.join(base, 'dst');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(src, 'new.db'), 'new');
  fs.writeFileSync(path.join(dst, 'old.db'), 'old');
  // No prompt — should default to import (both files survive, source wins)
  const result = await migrateDataDirectory(src, dst);
  assert.equal(result.action, 'moved');
  assert.ok(fs.existsSync(path.join(dst, 'new.db')));
  assert.ok(fs.existsSync(path.join(dst, 'old.db')));
  fs.rmSync(base, { recursive: true, force: true });
});
