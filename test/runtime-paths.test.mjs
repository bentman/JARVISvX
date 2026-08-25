import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PROJECT_ROOT, createRuntimePaths, ensureRuntimePaths } from '../lib/runtime-paths.mjs';
import { TARGETS, packagerOptions, selectTarget } from '../scripts/package-desktop.mjs';

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-paths-'));

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

test('source execution resolves every location under the installation directory', () => {
  const paths = createRuntimePaths({ root: PROJECT_ROOT, env: {} });

  assert.equal(paths.dataRoot, path.join(PROJECT_ROOT, 'data'));
  assert.equal(paths.cacheRoot, path.join(PROJECT_ROOT, 'cache'));
  assert.equal(paths.tempRoot, path.join(PROJECT_ROOT, 'cache', 'temp'));
  assert.equal(paths.modelRoot, path.join(PROJECT_ROOT, 'models'));
  assert.equal(paths.profileRoot, path.join(PROJECT_ROOT, 'data', 'electron-profile'));
  assert.equal(paths.sessionRoot, path.join(PROJECT_ROOT, 'cache', 'electron', 'session'));
  assert.equal(paths.logRoot, path.join(PROJECT_ROOT, 'cache', 'electron', 'logs'));
  assert.equal(paths.crashRoot, path.join(PROJECT_ROOT, 'cache', 'electron', 'crash-dumps'));
  assert.equal(paths.agentConfigPath, path.join(PROJECT_ROOT, 'data', 'agents.json'));
  assert.equal(paths.databasePath, path.join(PROJECT_ROOT, 'data', 'sql-db', 'jarvis.sqlite'));
  assert.equal(paths.providerKeyPath, path.join(PROJECT_ROOT, 'data', 'provider.key'));
});

test('a root outside the source tree keeps every mutable location beneath it', () => {
  const directory = scratch();
  try {
    const paths = createRuntimePaths({ root: directory, env: {} });
    const mutable = [paths.dataRoot, paths.cacheRoot, paths.tempRoot, paths.modelRoot, paths.profileRoot,
      paths.sessionRoot, paths.logRoot, paths.crashRoot, paths.agentConfigPath, paths.databasePath,
      paths.discoveryPath, paths.lockPath, paths.providerKeyPath];

    for (const location of mutable) {
      assert.ok(location.startsWith(directory + path.sep), `${location} should resolve under ${directory}`);
      assert.ok(!location.includes('app.asar'), `${location} must not resolve inside the archive`);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the documented environment overrides relocate their own roots only', () => {
  const directory = scratch();
  try {
    const env = {
      JARVIS_DATA_DIR: path.join(directory, 'elsewhere-data'),
      JARVIS_MODEL_DIR: path.join(directory, 'elsewhere-models'),
      JARVIS_TEMP_DIR: path.join(directory, 'elsewhere-temp'),
    };
    const paths = createRuntimePaths({ root: PROJECT_ROOT, env });

    assert.equal(paths.dataRoot, env.JARVIS_DATA_DIR);
    assert.equal(paths.modelRoot, env.JARVIS_MODEL_DIR);
    assert.equal(paths.tempRoot, env.JARVIS_TEMP_DIR);
    // Data-derived locations follow their root; cache-derived ones do not move.
    assert.equal(paths.agentConfigPath, path.join(env.JARVIS_DATA_DIR, 'agents.json'));
    assert.equal(paths.profileRoot, path.join(env.JARVIS_DATA_DIR, 'electron-profile'));
    assert.equal(paths.cacheRoot, path.join(PROJECT_ROOT, 'cache'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ensureRuntimePaths creates every directory and names the location it could not', () => {
  const directory = scratch();
  try {
    const paths = ensureRuntimePaths(createRuntimePaths({ root: path.join(directory, 'install'), env: {} }));
    for (const key of ['dataRoot', 'cacheRoot', 'tempRoot', 'modelRoot', 'profileRoot', 'sessionRoot', 'logRoot', 'crashRoot']) {
      assert.ok(fs.statSync(paths[key]).isDirectory(), `${key} should exist`);
    }

    const blocker = path.join(directory, 'blocked');
    fs.writeFileSync(blocker, 'not a directory');
    assert.throws(() => ensureRuntimePaths(createRuntimePaths({ root: blocker, env: {} })), (error) => {
      assert.equal(error.code, 'runtime_path');
      assert.equal(error.key, 'dataRoot');
      assert.equal(error.location, path.join(blocker, 'data'));
      assert.equal(error.operation, 'create');
      return true;
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Desktop packaging targets
// ---------------------------------------------------------------------------

test('packaging declares its desktop targets and refuses an undeclared pair', () => {
  assert.deepEqual(Object.keys(TARGETS).sort(), ['linux-x64', 'win32-x64']);

  assert.equal(selectTarget(['--platform', 'win32', '--arch', 'x64']).key, 'win32-x64');
  assert.equal(selectTarget([], { platform: 'linux', arch: 'x64' }).key, 'linux-x64');
  assert.throws(() => selectTarget(['--platform', 'darwin', '--arch', 'x64']), /No desktop target for "darwin-x64"/);

  assert.match(packagerOptions(selectTarget(['--platform', 'win32', '--arch', 'x64'])).icon, /icon\.ico$/);
  assert.match(packagerOptions(selectTarget(['--platform', 'linux', '--arch', 'x64'])).icon, /icon\.png$/);

  // Runtime state and operator secrets stay out of the bundle.
  const { ignore } = packagerOptions(selectTarget(['--platform', 'linux', '--arch', 'x64']));
  for (const candidate of ['/data/', '/cache/', '/models/', '/.jarvis/', '/.env']) {
    assert.ok(ignore.some((rule) => new RegExp(rule).test(candidate)), `${candidate} should be excluded`);
  }
});
