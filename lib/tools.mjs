import fs from 'node:fs/promises'; import path from 'node:path';
const MAX_BYTES = 1024 * 1024;
export class ToolError extends Error { constructor(message, code = 'tool_error') { super(message); this.code = code; } }
export async function canonicalRoot(input) { const resolved = path.resolve(input); const stat = await fs.stat(resolved); if (!stat.isDirectory()) throw new ToolError('Workspace root must be a directory.', 'not_directory'); return fs.realpath(resolved); }
export async function readWorkspaceFile(filePath, roots) { const absolute = path.resolve(filePath); const real = await fs.realpath(absolute).catch(() => { throw new ToolError('File does not exist.', 'not_found'); }); const permitted = roots.some((root) => real === root || real.startsWith(`${root}${path.sep}`)); if (!permitted) throw new ToolError('File is outside approved workspace roots.', 'not_authorized'); const stat = await fs.stat(real); if (!stat.isFile()) throw new ToolError('Path must be a file.', 'not_file'); if (stat.size > MAX_BYTES) throw new ToolError('File exceeds the 1 MiB read limit.', 'too_large'); const content = await fs.readFile(real, 'utf8'); if (content.includes('\0')) throw new ToolError('Binary files cannot be read.', 'binary'); return { path: real, content, size: stat.size }; }
export async function writeWorkspaceFile(filePath, content, roots) { const absolute = path.resolve(filePath); const permitted = roots.some((root) => absolute === root || absolute.startsWith(`${root}${path.sep}`)); if (!permitted) throw new ToolError('File is outside approved workspace roots.', 'not_authorized'); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, content, 'utf8'); return { path: absolute, bytesWritten: Buffer.byteLength(content, 'utf8') }; }

const SEARCH_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__', '.venv', 'venv', '.cache']);
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_MAX_RESULTS = 20;
const SEARCH_MAX_FILES_SCANNED = 4000;

// Real local search across approved workspace roots: a filename match, or a
// case-insensitive substring match against file content (bounded by size,
// result count, and total files scanned so a large repo can't hang a turn).
// Backs the /search skill (see lib/database.mjs's seeded skills).
export async function searchWorkspace(query, roots) {
  const needle = String(query || '').trim();
  if (!needle) throw new ToolError('A search query is required.', 'validation');
  if (!roots.length) throw new ToolError('No approved workspace roots to search.', 'not_authorized');
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
      const lines = content.split('\n');
      const lineIndex = lines.findIndex((line) => line.toLowerCase().includes(lowerNeedle));
      if (lineIndex === -1) continue;
      results.push({ path: full, relativePath, matchType: 'content', line: lineIndex + 1, snippet: lines[lineIndex].trim().slice(0, 200) });
    }
  }

  for (const root of roots) {
    if (results.length >= SEARCH_MAX_RESULTS) break;
    await walk(root, root);
  }

  return { query: needle, roots, results, scannedFiles: scanned, truncated: scanned >= SEARCH_MAX_FILES_SCANNED || results.length >= SEARCH_MAX_RESULTS };
}

export const registeredTools = [
  { id: 'diagnostics', description: 'Read real local runtime and provider diagnostics.', permission: 'read-only' },
  { id: 'read_workspace_file', description: 'Read UTF-8 text from an approved workspace root.', permission: 'read-only-root-scoped' },
  { id: 'propose_workspace_edit', description: 'Propose a code edit or file change for explicit user review.', permission: 'future-safe-boundary' },
  { id: 'write_workspace_file', description: 'Write UTF-8 text to an approved workspace file after human approval.', permission: 'human-approval-required' }
];

