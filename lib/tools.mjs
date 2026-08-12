import fs from 'node:fs/promises'; import path from 'node:path';
const MAX_BYTES = 1024 * 1024;
export class ToolError extends Error { constructor(message, code = 'tool_error') { super(message); this.code = code; } }
export async function canonicalRoot(input) { const resolved = path.resolve(input); const stat = await fs.stat(resolved); if (!stat.isDirectory()) throw new ToolError('Workspace root must be a directory.', 'not_directory'); return fs.realpath(resolved); }
export async function readWorkspaceFile(filePath, roots) { const absolute = path.resolve(filePath); const real = await fs.realpath(absolute).catch(() => { throw new ToolError('File does not exist.', 'not_found'); }); const permitted = roots.some((root) => real === root || real.startsWith(`${root}${path.sep}`)); if (!permitted) throw new ToolError('File is outside approved workspace roots.', 'not_authorized'); const stat = await fs.stat(real); if (!stat.isFile()) throw new ToolError('Path must be a file.', 'not_file'); if (stat.size > MAX_BYTES) throw new ToolError('File exceeds the 1 MiB read limit.', 'too_large'); const content = await fs.readFile(real, 'utf8'); if (content.includes('\0')) throw new ToolError('Binary files cannot be read.', 'binary'); return { path: real, content, size: stat.size }; }
export async function writeWorkspaceFile(filePath, content, roots) { const absolute = path.resolve(filePath); const permitted = roots.some((root) => absolute === root || absolute.startsWith(`${root}${path.sep}`)); if (!permitted) throw new ToolError('File is outside approved workspace roots.', 'not_authorized'); await fs.mkdir(path.dirname(absolute), { recursive: true }); await fs.writeFile(absolute, content, 'utf8'); return { path: absolute, bytesWritten: Buffer.byteLength(content, 'utf8') }; }
export const registeredTools = [
  { id: 'diagnostics', description: 'Read real local runtime and provider diagnostics.', permission: 'read-only' },
  { id: 'read_workspace_file', description: 'Read UTF-8 text from an approved workspace root.', permission: 'read-only-root-scoped' },
  { id: 'propose_workspace_edit', description: 'Propose a code edit or file change for explicit user review.', permission: 'future-safe-boundary' },
  { id: 'write_workspace_file', description: 'Write UTF-8 text to an approved workspace file after human approval.', permission: 'human-approval-required' }
];

