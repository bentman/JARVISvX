import fs from 'node:fs/promises'; import path from 'node:path';
const MAX_BYTES = 1024 * 1024;
class ToolError extends Error { constructor(message, code = 'tool_error') { super(message); this.code = code; } }
export async function canonicalRoot(input) { const resolved = path.resolve(input); const stat = await fs.stat(resolved); if (!stat.isDirectory()) throw new ToolError('Workspace root must be a directory.', 'not_directory'); return fs.realpath(resolved); }

const contains = (root, target) => { if (root === target) return true; const relative = path.relative(root, target); return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative); };

const ROOT_REALPATH_CACHE = new Map();
const ROOT_CACHE_TTL_MS = 5_000;

async function resolvedRoots(roots) {
  const resolved = [];
  const now = Date.now();
  for (const root of roots || []) {
    const key = path.resolve(root);
    const cached = ROOT_REALPATH_CACHE.get(key);
    if (cached && now - cached.at < ROOT_CACHE_TTL_MS) {
      if (cached.real) resolved.push(cached.real);
      continue;
    }
    const real = await fs.realpath(key).catch(() => null);
    ROOT_REALPATH_CACHE.set(key, { real, at: now });
    if (real) resolved.push(real);
  }
  return resolved;
}

const DIR_REALPATH_CACHE = new Map();
const DIR_CACHE_MAX = 512;
const DIR_CACHE_TTL_MS = 3_000;

async function safeRealpath(p) {
  const now = Date.now();
  const cached = DIR_REALPATH_CACHE.get(p);
  if (cached && now - cached.at < DIR_CACHE_TTL_MS) {
    return cached.real;
  }
  const real = await fs.realpath(p).catch(() => null);
  if (real) {
    if (DIR_REALPATH_CACHE.size >= DIR_CACHE_MAX) {
      const first = DIR_REALPATH_CACHE.keys().next().value;
      DIR_REALPATH_CACHE.delete(first);
    }
    DIR_REALPATH_CACHE.set(p, { real, at: now });
  }
  return real;
}

// The one containment check. Both the target and its nearest existing parent pass
// through real-path resolution, so a symlink or Windows junction cannot name a
// path outside an approved root. An empty root set fails closed.
export async function resolveWithinRoots(target, roots, { mustExist = false } = {}) {
  const approved = await resolvedRoots(roots);
  if (!approved.length) throw new ToolError('No approved workspace roots are configured.', 'not_authorized');
  let existing = path.resolve(target);
  const trailing = [];
  for (;;) {
    const real = await safeRealpath(existing);
    if (real) {
      const candidate = trailing.length ? path.join(real, ...trailing) : real;
      if (!approved.some((root) => contains(root, candidate))) throw new ToolError('Path is outside approved workspace roots.', 'not_authorized');
      if (mustExist && trailing.length) throw new ToolError('Path does not exist.', 'not_found');
      return candidate;
    }
    const parent = path.dirname(existing);
    if (parent === existing) throw new ToolError('Path is outside approved workspace roots.', 'not_authorized');
    trailing.unshift(path.basename(existing));
    existing = parent;
  }
}

// Git and directory tools need a concrete approved root as their working directory;
// the process working directory is never an implicit one.
export async function selectApprovedRoot(roots, preferred = null) {
  const approved = await resolvedRoots(roots);
  if (!approved.length) throw new ToolError('No approved workspace roots are configured.', 'not_authorized');
  if (!preferred) return approved[0];
  return resolveWithinRoots(preferred, roots, { mustExist: true });
}


export async function readWorkspaceFile(filePath, roots) { const real = await resolveWithinRoots(filePath, roots, { mustExist: true }); const stat = await fs.stat(real); if (!stat.isFile()) throw new ToolError('Path must be a file.', 'not_file'); if (stat.size > MAX_BYTES) throw new ToolError('File exceeds the 1 MiB read limit.', 'too_large'); const content = await fs.readFile(real, 'utf8'); if (content.includes('\0')) throw new ToolError('Binary files cannot be read.', 'binary'); return { path: real, content, size: stat.size }; }
export async function writeWorkspaceFile(filePath, content, roots) { const target = await resolveWithinRoots(filePath, roots); DIR_REALPATH_CACHE.delete(target); DIR_REALPATH_CACHE.delete(path.dirname(target)); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content, 'utf8'); return { path: target, bytesWritten: Buffer.byteLength(content, 'utf8') }; }

const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', '.cache']);
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_RESULTS = 20;
const SEARCH_MAX_FILES_SCANNED = 4000;

// Search is confined to approved roots and bounded by file size, result count,
// and scanned-file count.
export async function searchWorkspace(query, roots) {
  const needle = String(query || '').trim();
  if (!needle) throw new ToolError('A search query is required.', 'validation');
  const approvedRoots = await resolvedRoots(roots);
  if (!approvedRoots.length) throw new ToolError('No approved workspace roots to search.', 'not_authorized');
  const lowerNeedle = needle.toLowerCase();
  const results = [];
  let scanned = 0;

  async function walk(dir, root) {
    if (results.length >= SEARCH_MAX_RESULTS || scanned >= SEARCH_MAX_FILES_SCANNED) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (results.length >= SEARCH_MAX_RESULTS || scanned >= SEARCH_MAX_FILES_SCANNED) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SEARCH_SKIP_DIRS.has(entry.name)) continue;
        await walk(full, root);
        continue;
      }
      if (!entry.isFile()) continue;
      scanned += 1;
      const relativePath = path.relative(root, full);
      if (entry.name.toLowerCase().includes(lowerNeedle)) {
        results.push({ path: full, relativePath, matchType: 'name' });
        continue;
      }
      let stat;
      try { stat = await fs.stat(full); } catch { continue; }
      if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
      let content;
      try { content = await fs.readFile(full, 'utf8'); } catch { continue; }
      if (content.includes('\0')) continue; // binary
      if (!content.toLowerCase().includes(lowerNeedle)) continue;
      const lines = content.split('\n');
      const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(lowerNeedle));
      if (lineIndex === -1) continue;
      results.push({ path: full, relativePath, matchType: 'content', line: lineIndex + 1, snippet: lines[lineIndex].trim().slice(0, 200) });
    }
  }

  for (const root of approvedRoots) {
    if (results.length >= SEARCH_MAX_RESULTS) break;
    await walk(root, root);
  }

  return { query: needle, roots: approvedRoots, results, scannedFiles: scanned, truncated: scanned >= SEARCH_MAX_FILES_SCANNED || results.length >= SEARCH_MAX_RESULTS };
}

export const registeredTools = [
  { id: 'diagnostics', description: 'Read real local runtime and provider diagnostics.', permission: 'read-only' },
  { id: 'read_workspace_file', description: 'Read UTF-8 text from an approved workspace root.', permission: 'read-only' },
  { id: 'propose_workspace_edit', description: 'Propose a code edit or file change for explicit user review.', permission: 'read-only' },
  { id: 'write_workspace_file', description: 'Write UTF-8 text to an approved workspace file after human approval.', permission: 'approval-required' }
];
