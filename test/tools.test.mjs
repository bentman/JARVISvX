import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { canonicalRoot, readWorkspaceFile } from '../lib/tools.mjs';

test('workspace reader permits approved UTF-8 files only', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-root-'));
  const approved = path.join(directory, 'approved'); const outside = path.join(directory, 'outside.txt');
  await fs.mkdir(approved); await fs.writeFile(path.join(approved, 'hello.txt'), 'Hello JARVIS'); await fs.writeFile(outside, 'No access');
  const root = await canonicalRoot(approved);
  assert.equal((await readWorkspaceFile(path.join(approved, 'hello.txt'), [root])).content, 'Hello JARVIS');
  await assert.rejects(readWorkspaceFile(outside, [root]), { code: 'not_authorized' });
  await fs.rm(directory, { recursive: true, force: true });
});
