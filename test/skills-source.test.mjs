import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  parseSkillSource,
  parseSkillFrontmatter,
  fetchSkillMarkdown,
  buildImportedSkill,
  renderSkillAsMarkdown
} from '../lib/skills-source.mjs';
import { createJarvisApp } from '../lib/application.mjs';
import { JarvisDatabase } from '../lib/database.mjs';

function createTestApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-skills-source-'));
  const app = createJarvisApp({ database: new JarvisDatabase(path.join(directory, 'jarvis.sqlite')) });
  return {
    app,
    cleanup() {
      try { app.db.close(); } catch {}
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

test('parseSkillSource handles the shorthand, @ref, subpath, and full-URL forms skills.sh itself accepts', () => {
  assert.deepEqual(parseSkillSource('vercel-labs/agent-skills'), { owner: 'vercel-labs', repo: 'agent-skills', ref: null, subpath: '' });
  assert.deepEqual(parseSkillSource('vercel-labs/agent-skills@v2'), { owner: 'vercel-labs', repo: 'agent-skills', ref: 'v2', subpath: '' });
  assert.deepEqual(
    parseSkillSource('https://github.com/vercel-labs/agent-skills'),
    { owner: 'vercel-labs', repo: 'agent-skills', ref: null, subpath: '' }
  );
  assert.deepEqual(
    parseSkillSource('https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines'),
    { owner: 'vercel-labs', repo: 'agent-skills', ref: 'main', subpath: 'skills/web-design-guidelines' }
  );
  assert.deepEqual(
    parseSkillSource('git@github.com:acme/private-skills.git'),
    { owner: 'acme', repo: 'private-skills', ref: null, subpath: '' }
  );

  assert.throws(() => parseSkillSource(''), /source is required/);
  assert.throws(() => parseSkillSource('just-a-name'), /Could not parse/);
  assert.throws(() => parseSkillSource('https://gitlab.com/owner/repo'), /Only github\.com sources/);
});

test('parseSkillFrontmatter splits real SKILL.md-shaped YAML frontmatter from its body', () => {
  const markdown = '---\nname: web-design-guidelines\ndescription: "Guidance for consistent UI design"\n---\n\n# Web Design Guidelines\n\nUse consistent spacing.';
  const { frontmatter, body } = parseSkillFrontmatter(markdown);
  assert.equal(frontmatter.name, 'web-design-guidelines');
  assert.equal(frontmatter.description, 'Guidance for consistent UI design');
  assert.equal(body, '# Web Design Guidelines\n\nUse consistent spacing.');

  // No frontmatter block at all — the whole thing is treated as the body.
  const plain = parseSkillFrontmatter('Just instructions, no frontmatter.');
  assert.deepEqual(plain.frontmatter, {});
  assert.equal(plain.body, 'Just instructions, no frontmatter.');
});

test('fetchSkillMarkdown tries the real candidate raw.githubusercontent.com paths in order and stops at the first hit', async () => {
  const requested = [];
  const fakeFetch = async (url) => {
    requested.push(url);
    if (url.includes('/repos/acme/tools')) {
      return { ok: true, json: async () => ({ default_branch: 'trunk' }) };
    }
    if (url === 'https://raw.githubusercontent.com/acme/tools/trunk/SKILL.md') {
      return { ok: true, text: async () => '---\nname: tools\ndescription: d\n---\nbody text' };
    }
    return { ok: false };
  };

  const result = await fetchSkillMarkdown({ owner: 'acme', repo: 'tools', ref: null, subpath: '' }, fakeFetch);
  assert.equal(result.content, '---\nname: tools\ndescription: d\n---\nbody text');
  assert.equal(result.resolvedRef, 'trunk');
  assert.ok(requested.includes('https://raw.githubusercontent.com/acme/tools/trunk/SKILL.md'));
});

test('fetchSkillMarkdown fails honestly (no fabricated content) when nothing is found, listing exactly what it tried', async () => {
  const fakeFetch = async () => ({ ok: false });
  await assert.rejects(
    fetchSkillMarkdown({ owner: 'acme', repo: 'missing', ref: 'main', subpath: '' }, fakeFetch),
    /No SKILL\.md found for "acme\/missing".*raw\.githubusercontent\.com\/acme\/missing\/main\/SKILL\.md/s
  );
});

test('buildImportedSkill turns a real fetched SKILL.md into an executable skill whose output is the actual instructions text, not a guess', async () => {
  const { frontmatter, body } = parseSkillFrontmatter('---\nname: Web Design Guidelines\ndescription: Keep UI consistent\n---\n\nUse an 8px spacing grid.');
  const built = buildImportedSkill({ owner: 'vercel-labs', repo: 'agent-skills', ref: null, resolvedRef: 'main' }, frontmatter, body);

  assert.equal(built.name, 'Web Design Guidelines');
  assert.equal(built.slashCommand, '/web-design-guidelines');
  assert.equal(built.description, 'Keep UI consistent');
  assert.equal(built.author, 'skills.sh:vercel-labs/agent-skills');
  assert.equal(built.version, 'main');

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('ctx', `return (${built.code})(ctx);`);
  const result = await fn({ input: '' });
  assert.equal(result.output, 'Use an 8px spacing grid.');

  const withInput = await fn({ input: 'buttons' });
  assert.match(withInput.output, /Use an 8px spacing grid\./);
  assert.match(withInput.output, /Requested with: buttons/);
});

test('buildImportedSkill safely escapes instructions containing backticks and template interpolation syntax', async () => {
  const { frontmatter, body } = parseSkillFrontmatter('---\nname: tricky\n---\nUse `npm install` and note ${DANGER} is not real interpolation.');
  const built = buildImportedSkill({ owner: 'a', repo: 'b', ref: 'main' }, frontmatter, body);

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const fn = new AsyncFunction('ctx', `return (${built.code})(ctx);`);
  const result = await fn({ input: '' });
  assert.equal(result.output, 'Use `npm install` and note ${DANGER} is not real interpolation.');
});

test('renderSkillAsMarkdown exports an existing skill in real SKILL.md shape with its actual code intact', () => {
  const { filename, content } = renderSkillAsMarkdown({
    name: 'Calc',
    slashCommand: '/calc',
    description: 'Evaluates expressions',
    author: 'User',
    version: '1.0.0',
    code: 'async function execute({ input }) { return input; }'
  });
  assert.equal(filename, 'calc.SKILL.md');
  assert.match(content, /^---\nname: Calc/);
  assert.match(content, /slashCommand: \/calc/);
  assert.match(content, /```js\nasync function execute/);
});

test('app.importSkillFromSource fetches a real SKILL.md over the (stubbed) network and persists a genuine, executable custom skill', async () => {
  const { app, cleanup } = createTestApp();
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/repos/')) return { ok: true, json: async () => ({ default_branch: 'main' }) };
    if (String(url) === 'https://raw.githubusercontent.com/octo/demo/main/SKILL.md') {
      return { ok: true, text: async () => '---\nname: Demo Skill\ndescription: A demo\n---\nDo the demo thing.' };
    }
    return { ok: false };
  };

  try {
    const created = await app.importSkillFromSource('octo/demo');
    assert.equal(created.name, 'Demo Skill');
    assert.equal(created.author, 'skills.sh:octo/demo');
    assert.ok(app.skills().some((s) => s.id === created.id));

    const run = await app.executeSkill(created.id, '');
    assert.equal(run.success, true);
    assert.equal(run.output, 'Do the demo thing.');

    const exported = app.exportSkill(created.id);
    assert.equal(exported.filename, 'demo-skill.SKILL.md');
    assert.match(exported.content, /Do the demo thing\./);
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test('app.importSkillFromSource fails honestly when GitHub has nothing for the given source', async () => {
  const { app, cleanup } = createTestApp();
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false });

  try {
    await assert.rejects(app.importSkillFromSource('octo/does-not-exist'), /No SKILL\.md found/);
  } finally {
    global.fetch = originalFetch;
    cleanup();
  }
});

test('app.exportSkill fails honestly for an unknown skill id', () => {
  const { app, cleanup } = createTestApp();
  try {
    assert.throws(() => app.exportSkill('does-not-exist'), /not found/);
  } finally {
    cleanup();
  }
});
