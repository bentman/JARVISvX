import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JarvisDatabase, assertCredentialKeyAvailable, resolveDataDirectory, PROJECT_ROOT } from '../lib/database.mjs';
import { migrateDataDirectory, dataDirectoryInfo } from '../lib/data-migration.mjs';

// ---------------------------------------------------------------------------
// resolveDataDirectory — path resolution
// ---------------------------------------------------------------------------

// The default data directory is anchored to the installation, not the caller's cwd.
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

test('an unrecognized conflict decision raises a typed conflict instead of moving data', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-migrate-conflict-'));
  const source = path.join(base, 'source');
  const target = path.join(base, 'target');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(source, 'source.txt'), 'source');
  fs.writeFileSync(path.join(target, 'target.txt'), 'target');

  await assert.rejects(
    migrateDataDirectory(source, target, { prompt: async () => 'cancel' }),
    (error) => error.code === 'migration_conflict'
  );
  assert.ok(fs.existsSync(path.join(source, 'source.txt')), 'the source survives an unresolved conflict');
  assert.ok(fs.existsSync(path.join(target, 'target.txt')), 'the destination survives an unresolved conflict');
  fs.rmSync(base, { recursive: true, force: true });
});

test('stored credentials require their effective key material to be present', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-key-check-'));
  const originalSalt = process.env.JARVIS_KEY_SALT;
  delete process.env.JARVIS_KEY_SALT;
  try {
    const dataRoot = path.join(directory, 'data');
    const db = new JarvisDatabase({ dataRoot });
    // A database with no stored credential needs no key material.
    db.close();
    assertCredentialKeyAvailable(dataRoot);

    const withCredential = new JarvisDatabase({ dataRoot });
    withCredential.addProvider({ name: 'Cloud', protocol: 'openai-compat', base_url: 'https://example.invalid/v1', api_key: 'secret' });
    withCredential.close();
    assertCredentialKeyAvailable(dataRoot);

    // The database arriving without its file-backed key is reported, not opened blind.
    fs.rmSync(path.join(dataRoot, 'provider.key'));
    assert.throws(() => assertCredentialKeyAvailable(dataRoot), (error) => error.code === 'credential_key_missing');

    process.env.JARVIS_KEY_SALT = 'portable-salt';
    assertCredentialKeyAvailable(dataRoot);
  } finally {
    if (originalSalt === undefined) delete process.env.JARVIS_KEY_SALT; else process.env.JARVIS_KEY_SALT = originalSalt;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an existing empty destination is published without renaming onto it', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-migrate-empty-'));
  const source = path.join(base, 'source');
  const target = path.join(base, 'target');
  fs.mkdirSync(path.join(source, 'sql-db'), { recursive: true });
  fs.writeFileSync(path.join(source, 'sql-db', 'jarvis.sqlite'), 'database');
  fs.writeFileSync(path.join(source, 'operator.txt'), 'durable');
  fs.mkdirSync(target, { recursive: true });

  const result = await migrateDataDirectory(source, target);
  assert.equal(result.action, 'moved');
  assert.equal(fs.readFileSync(path.join(target, 'sql-db', 'jarvis.sqlite'), 'utf8'), 'database');
  assert.equal(fs.readFileSync(path.join(target, 'operator.txt'), 'utf8'), 'durable');
  assert.equal(fs.existsSync(source), false);
  assert.deepEqual(fs.readdirSync(base).filter((entry) => entry.includes('staging')), [], 'staging is not left behind');

  // Re-running converges rather than failing or duplicating.
  const again = await migrateDataDirectory(source, target);
  assert.equal(again.action, 'created');
  assert.equal(fs.readFileSync(path.join(target, 'operator.txt'), 'utf8'), 'durable');
  fs.rmSync(base, { recursive: true, force: true });
});

test('a failure before publication leaves the source complete and no staging behind', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-migrate-interrupt-'));
  const source = path.join(base, 'source');
  const target = path.join(base, 'nested', 'target');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'operator.txt'), 'durable');

  // A destination path that cannot be created fails the publish step.
  fs.writeFileSync(path.join(base, 'nested'), 'not a directory');
  await assert.rejects(migrateDataDirectory(source, target));
  assert.equal(fs.readFileSync(path.join(source, 'operator.txt'), 'utf8'), 'durable', 'the source survives a failed publish');
  assert.deepEqual(fs.readdirSync(base).filter((entry) => entry.includes('staging')), [], 'and no staging directory is left behind');
  fs.rmSync(base, { recursive: true, force: true });
});

// The copy is failed by removing read permission, which Windows does not model:
// chmod there controls the read-only attribute and cannot deny a read. The
// preceding case covers the same guarantee through a portable failure.
const UNREADABLE_SOURCE_SKIP = process.platform === 'win32'
  && 'POSIX mode bits cannot deny read on Windows.';

test('a failure partway through staging keeps the source and discards the partial copy', { skip: UNREADABLE_SOURCE_SKIP }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-migrate-partial-'));
  const source = path.join(base, 'source');
  const target = path.join(base, 'target');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'a-readable.txt'), 'durable');
  const unreadable = path.join(source, 'b-unreadable.txt');
  fs.writeFileSync(unreadable, 'secret');
  fs.chmodSync(unreadable, 0o000);

  try {
    await assert.rejects(migrateDataDirectory(source, target));
    assert.equal(fs.readFileSync(path.join(source, 'a-readable.txt'), 'utf8'), 'durable', 'the source is untouched');
    assert.ok(fs.existsSync(unreadable), 'including the file that could not be copied');
    assert.equal(fs.existsSync(target), false, 'nothing was published');
    assert.deepEqual(fs.readdirSync(base).filter((entry) => entry.includes('staging')), [], 'the partial copy is discarded');
  } finally {
    fs.chmodSync(unreadable, 0o600);
    fs.rmSync(base, { recursive: true, force: true });
  }
});
