import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  canonicalRoot,
  readWorkspaceFile,
  writeWorkspaceFile,
  searchWorkspace,
  selectApprovedRoot,
  registeredTools
} from '../lib/tools.mjs';

test('workspace reader permits approved UTF-8 files only and rejects unauthorized or missing files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-root-'));
  try {
    const approved = path.join(directory, 'approved');
    const outside = path.join(directory, 'outside.txt');
    await fs.mkdir(approved);
    await fs.writeFile(path.join(approved, 'hello.txt'), 'Hello JARVIS');
    await fs.writeFile(outside, 'No access');

    const root = await canonicalRoot(approved);
    assert.equal((await readWorkspaceFile(path.join(approved, 'hello.txt'), [root])).content, 'Hello JARVIS');
    await assert.rejects(readWorkspaceFile(outside, [root]), { code: 'not_authorized' });
    await assert.rejects(readWorkspaceFile(path.join(approved, 'missing.txt'), [root]), { code: 'not_found' });
    await assert.rejects(readWorkspaceFile(path.join(approved, 'hello.txt'), []), { code: 'not_authorized' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('readWorkspaceFile enforces file type, 1 MiB size cap, and binary content boundaries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-read-limits-'));
  try {
    const root = await canonicalRoot(directory);

    // Directory instead of file
    const subDir = path.join(directory, 'subdir');
    await fs.mkdir(subDir);
    await assert.rejects(readWorkspaceFile(subDir, [root]), { code: 'not_file' });

    // File exceeding 1 MiB cap
    const largeFile = path.join(directory, 'large.txt');
    const largeBuffer = Buffer.alloc(1024 * 1024 + 1, 'a');
    await fs.writeFile(largeFile, largeBuffer);
    await assert.rejects(readWorkspaceFile(largeFile, [root]), { code: 'too_large' });

    // Binary file with null byte
    const binaryFile = path.join(directory, 'binary.txt');
    await fs.writeFile(binaryFile, 'hello\0world');
    await assert.rejects(readWorkspaceFile(binaryFile, [root]), { code: 'binary' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('writeWorkspaceFile creates files and parent directories, and rejects outside paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-write-'));
  try {
    const approved = path.join(directory, 'approved');
    await fs.mkdir(approved);
    const root = await canonicalRoot(approved);

    const target = path.join(approved, 'nested', 'deep', 'test.txt');
    const result = await writeWorkspaceFile(target, 'written content', [root]);
    assert.equal(result.bytesWritten, Buffer.byteLength('written content', 'utf8'));

    const readBack = await fs.readFile(target, 'utf8');
    assert.equal(readBack, 'written content');

    // Reject write outside approved roots
    const outsideTarget = path.join(directory, 'unauthorized.txt');
    await assert.rejects(writeWorkspaceFile(outsideTarget, 'bad', [root]), { code: 'not_authorized' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('searchWorkspace finds matches by name and content, respecting ignored directories and binary files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-search-'));
  try {
    const approved = path.join(directory, 'approved');
    await fs.mkdir(approved);
    const root = await canonicalRoot(approved);

    // Content match
    await fs.writeFile(path.join(approved, 'document.txt'), 'first line\nneedle in a haystack\nlast line');

    // Filename match
    const subDir = path.join(approved, 'sub');
    await fs.mkdir(subDir);
    await fs.writeFile(path.join(subDir, 'my-needle-tool.js'), 'irrelevant text');

    // Ignored directory match (should be skipped)
    const nodeModules = path.join(approved, 'node_modules');
    await fs.mkdir(nodeModules);
    await fs.writeFile(path.join(nodeModules, 'needle.txt'), 'needle inside ignored dir');

    // Usable workspace artifacts in cache (temp) and data (durable) should be found
    const cacheDir = path.join(approved, 'cache');
    await fs.mkdir(cacheDir);
    await fs.writeFile(path.join(cacheDir, 'artifact.txt'), 'needle in temporary workspace cache');

    const dataDir = path.join(approved, 'data');
    await fs.mkdir(dataDir);
    await fs.writeFile(path.join(dataDir, 'durable_item.txt'), 'needle in durable data store');

    // Engine runtime directories within cache and data (should be skipped)
    const electronCache = path.join(cacheDir, 'electron');
    await fs.mkdir(electronCache);
    await fs.writeFile(path.join(electronCache, 'needle.txt'), 'needle inside electron cache');

    const profileData = path.join(dataDir, 'electron-profile');
    await fs.mkdir(profileData);
    await fs.writeFile(path.join(profileData, 'needle.txt'), 'needle inside electron profile');

    const sqlDbData = path.join(dataDir, 'sql-db');
    await fs.mkdir(sqlDbData);
    await fs.writeFile(path.join(sqlDbData, 'needle.txt'), 'needle inside sql-db');

    // .agentignore (should be honored)
    await fs.writeFile(path.join(approved, '.agentignore'), 'ignored_folder\ncustom_ignored.txt\n');
    const ignoredFolder = path.join(approved, 'ignored_folder');
    await fs.mkdir(ignoredFolder);
    await fs.writeFile(path.join(ignoredFolder, 'needle.txt'), 'needle inside agentignore folder');
    await fs.writeFile(path.join(approved, 'custom_ignored.txt'), 'needle inside agentignore file');

    // Binary file (should be skipped for content search)
    await fs.writeFile(path.join(approved, 'data.bin'), 'binary\0needle');

    const search = await searchWorkspace('needle', [root]);
    assert.equal(search.query, 'needle');
    assert.ok(search.results.length >= 4);

    const contentHit = search.results.find((r) => r.relativePath === 'document.txt');
    assert.ok(contentHit);
    assert.equal(contentHit.line, 2);
    assert.ok(contentHit.snippet.includes('needle in a haystack'));

    const nameHit = search.results.find((r) => r.matchType === 'name');
    assert.ok(nameHit);
    assert.ok(nameHit.relativePath.includes('my-needle-tool.js'));

    // Cache and data artifacts must be found
    assert.ok(search.results.some((r) => r.relativePath.includes(path.join('cache', 'artifact.txt'))));
    assert.ok(search.results.some((r) => r.relativePath.includes(path.join('data', 'durable_item.txt'))));

    // Internal runtime engine dirs, node_modules, agentignore, and binary matches must be excluded
    assert.ok(!search.results.some((r) => r.relativePath.includes('node_modules')));
    assert.ok(!search.results.some((r) => r.relativePath.includes('electron')));
    assert.ok(!search.results.some((r) => r.relativePath.includes('electron-profile')));
    assert.ok(!search.results.some((r) => r.relativePath.includes('sql-db')));
    assert.ok(!search.results.some((r) => r.relativePath.includes('ignored_folder')));
    assert.ok(!search.results.some((r) => r.relativePath.includes('custom_ignored.txt')));
    assert.ok(!search.results.some((r) => r.relativePath.includes('data.bin')));

    // Validation checks
    await assert.rejects(searchWorkspace('', [root]), { code: 'validation' });
    await assert.rejects(searchWorkspace('needle', []), { code: 'not_authorized' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('canonicalRoot and selectApprovedRoot resolve roots and enforce directory boundaries', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-roots-'));
  try {
    const dirA = path.join(directory, 'a');
    const dirB = path.join(directory, 'b');
    await fs.mkdir(dirA);
    await fs.mkdir(dirB);

    const rootA = await canonicalRoot(dirA);
    const rootB = await canonicalRoot(dirB);

    // canonicalRoot rejects a non-directory
    const file = path.join(dirA, 'file.txt');
    await fs.writeFile(file, 'sample');
    await assert.rejects(canonicalRoot(file), { code: 'not_directory' });

    // selectApprovedRoot returns first root when preferred is omitted
    assert.equal(await selectApprovedRoot([rootA, rootB]), rootA);

    // selectApprovedRoot resolves preferred when provided
    assert.equal(await selectApprovedRoot([rootA, rootB], dirB), rootB);

    // selectApprovedRoot rejects when empty roots are provided
    await assert.rejects(selectApprovedRoot([]), { code: 'not_authorized' });

    // selectApprovedRoot rejects preferred when outside approved roots
    await assert.rejects(selectApprovedRoot([rootA], dirB), { code: 'not_authorized' });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('registeredTools exposes the canonical workspace tool declarations', () => {
  const byId = Object.fromEntries(registeredTools.map((t) => [t.id, t]));
  assert.ok(byId.diagnostics);
  assert.equal(byId.diagnostics.permission, 'read-only');
  assert.ok(byId.read_workspace_file);
  assert.equal(byId.read_workspace_file.permission, 'read-only');
  assert.ok(byId.propose_workspace_edit);
  assert.equal(byId.propose_workspace_edit.permission, 'read-only');
  assert.ok(byId.write_workspace_file);
  assert.equal(byId.write_workspace_file.permission, 'approval-required');
});

