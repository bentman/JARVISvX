// skills.sh imports use SKILL.md with YAML frontmatter. Imported instructions remain
// literal data inside an executable wrapper that uses the native skill execution path.

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

// Parses the reference formats skills.sh's own `add` command accepts (see
// github.com/vercel-labs/skills): "owner/repo", "owner/repo@ref",
// "owner/repo/sub/path", a full https://github.com/owner/repo(/tree/ref/path)? URL,
// or a git@github.com SSH URL. Returns { owner, repo, ref, subpath } with ref
// possibly null (meaning "use the repo's default branch").
export function parseSkillSource(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('A skill source is required — e.g. "owner/repo" or a github.com URL.');

  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2], ref: null, subpath: '' };

  let rest = raw;
  const urlMatch = raw.match(/^https?:\/\/([^/]+)\/(.+)$/i);
  if (urlMatch) {
    const host = urlMatch[1].toLowerCase();
    if (!GITHUB_HOSTS.has(host)) throw new Error(`Only github.com sources are supported right now (got "${host}").`);
    rest = urlMatch[2].replace(/\.git$/i, '');
  }

  const segments = rest.split('/').filter(Boolean);
  if (segments.length < 2) throw new Error(`Could not parse skill source "${input}". Expected "owner/repo" or a github.com URL.`);

  const owner = segments[0];
  let repoAndRef = segments[1];
  let ref = null;
  let subpathSegments = segments.slice(2);

  // "owner/repo/tree/<ref>/<subpath...>" or "owner/repo/blob/<ref>/<subpath...>"
  if ((subpathSegments[0] === 'tree' || subpathSegments[0] === 'blob') && subpathSegments.length >= 2) {
    ref = subpathSegments[1];
    subpathSegments = subpathSegments.slice(2);
  }

  // "owner/repo@ref"
  const atIndex = repoAndRef.indexOf('@');
  if (atIndex !== -1) {
    ref = ref || repoAndRef.slice(atIndex + 1);
    repoAndRef = repoAndRef.slice(0, atIndex);
  }

  const repo = repoAndRef.replace(/\.git$/i, '');
  if (!owner || !repo) throw new Error(`Could not parse skill source "${input}". Expected "owner/repo" or a github.com URL.`);

  return { owner, repo, ref, subpath: subpathSegments.join('/') };
}

// Supports flat key/value frontmatter; text after the first colon remains literal.
export function parseSkillFrontmatter(markdown) {
  const text = String(markdown || '');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: text.trim() };

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2].trim() };
}

// Raw HTTP discovery checks the documented root paths without listing the repository.
// An explicit subpath is exclusive.
function candidatePaths(subpath) {
  if (subpath) return [`${subpath}/SKILL.md`, `${subpath}.md`];
  return ['SKILL.md', 'skill.md', 'skills/SKILL.md'];
}

async function resolveDefaultBranch(owner, repo, fetchImpl) {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.default_branch || null;
  } catch {
    return null;
  }
}

// Injectable fetch keeps resolution deterministic in tests and defaults to global fetch.
export async function fetchSkillMarkdown({ owner, repo, ref, subpath }, fetchImpl = fetch) {
  const refsToTry = ref ? [ref] : [await resolveDefaultBranch(owner, repo, fetchImpl), 'main', 'master'].filter(Boolean);
  const uniqueRefs = [...new Set(refsToTry)];
  const paths = candidatePaths(subpath);

  const attempted = [];
  for (const candidateRef of uniqueRefs) {
    for (const candidatePath of paths) {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${candidateRef}/${candidatePath}`;
      attempted.push(url);
      try {
        const res = await fetchImpl(url);
        if (res.ok) {
          const content = await res.text();
          return { content, resolvedRef: candidateRef, resolvedPath: candidatePath, url };
        }
      } catch {
        // Network error on this candidate — keep trying the rest before failing.
      }
    }
  }
  throw new Error(`No SKILL.md found for "${owner}/${repo}"${subpath ? ` at "${subpath}"` : ''}. Tried:\n${attempted.join('\n')}`);
}

const slugifySlashCommand = (name) => {
  const slug = String(name || 'skill').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'skill';
  return `/${slug}`;
};

// Imported instruction text remains verbatim inside the executable skill record.
export function buildImportedSkill({ owner, repo, ref, resolvedRef }, frontmatter, body) {
  const name = frontmatter.name || repo;
  const description = frontmatter.description || `Imported from ${owner}/${repo}.`;
  const instructions = body || '(This skill had no instructions body.)';
  const escaped = instructions.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  const code = `async function execute({ input }) {\n  const instructions = \`${escaped}\`;\n  return { success: true, output: input ? \`\${instructions}\\n\\n---\\nRequested with: \${input}\` : instructions };\n}`;

  return {
    name,
    slashCommand: slugifySlashCommand(name),
    description,
    code,
    enabled: true,
    type: 'custom',
    author: `skills.sh:${owner}/${repo}`,
    version: ref || resolvedRef || 'latest'
  };
}

// Export uses SKILL.md frontmatter and preserves executable custom-skill code verbatim.
export function renderSkillAsMarkdown(skill) {
  const frontmatter = [
    '---',
    `name: ${skill.name}`,
    `description: ${skill.description || ''}`,
    `slashCommand: ${skill.slashCommand}`,
    `author: ${skill.author || 'User'}`,
    `version: ${skill.version || '1.0.0'}`,
    '---'
  ].join('\n');
  const content = `${frontmatter}\n\n# ${skill.name}\n\n${skill.description || ''}\n\n\`\`\`js\n${skill.code}\n\`\`\`\n`;
  const filename = `${skill.slashCommand.replace(/^\//, '') || 'skill'}.SKILL.md`;
  return { filename, content };
}
