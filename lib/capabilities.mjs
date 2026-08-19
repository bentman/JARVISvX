// Builds the single set of invokable capabilities — workspace tools, every
// enabled MCP server's declared tools, and every enabled skill — that a
// model can call directly during conversation. The same registry backs
// autonomous tool-calling and the existing /slash matcher: a skill is
// reachable by typing `/calc` or by the model invoking it mid-conversation,
// through the same executeSkill() call either way (see
// docs/adr-0002-unified-capability-registry.md). The @agent dispatcher is a
// separate entry point and is not part of this registry yet.

// Fixed schemas for the two core app tools that aren't sourced from an MCP
// server's tools_json (see lib/tools.mjs). MCP tool parameters are parsed from
// their descriptive spec string instead — see parseParameterSpec below.
const CORE_TOOL_SCHEMAS = {
  diagnostics: { type: 'object', properties: {} },
  propose_workspace_edit: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative or absolute file path.' },
      content: { type: 'string', description: 'Full proposed file content.' },
      reason: { type: 'string', description: 'Why this change is being proposed.' },
    },
    required: ['path', 'content', 'reason'],
  },
};

// lib/tools.mjs's `permission` tags describe each tool for the UI, not whether
// it's safe for a model to invoke unattended — propose_workspace_edit only ever
// stages a pending_review row (it never touches the filesystem; the existing
// workspace-edit approve/reject flow is the actual human checkpoint), so it's
// safe to auto-execute even though its UI tag is 'future-safe-boundary'.
const CORE_TOOL_PERMISSIONS = {
  diagnostics: 'read-only',
  propose_workspace_edit: 'read-only',
};

// Parses the loose "name: type, name2?: type2" spec strings MCP servers use to
// describe their tools (see the seed data in lib/database.mjs) into a JSON
// Schema object shape a provider's tool-calling API can use. A trailing '?' on
// a parameter name marks it optional.
function parseParameterSpec(spec) {
  if (!spec || spec === 'none') return { type: 'object', properties: {} };
  const properties = {};
  const required = [];
  for (const part of spec.split(',')) {
    const rawName = part.split(':')[0]?.trim();
    if (!rawName) continue;
    const optional = rawName.endsWith('?');
    const name = optional ? rawName.slice(0, -1) : rawName;
    properties[name] = { type: 'string' };
    if (!optional) required.push(name);
  }
  return required.length ? { type: 'object', properties, required } : { type: 'object', properties };
}

const isMutating = (tool) => tool.mutating === true || /^(write|delete|create)/i.test(tool.name);

// A skill's slashCommand (e.g. '/calc') isn't a valid tool name for most
// provider tool-calling APIs, which restrict names to [a-zA-Z0-9_-]. Strip
// the leading slash and replace anything else disallowed.
const slugifyToolName = (raw) => raw.replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'skill';

// Builds the list of { name, description, parameters, permission, execute }
// capabilities, sourced from every MCP server's declared tools, the two core
// app tools not already covered by one (read_workspace_file and
// write_workspace_file are both declared by the built-in mcp-fs server, so
// lib/tools.mjs's copies of those two are skipped here to avoid a duplicate
// tool name with two different execution paths), and every enabled skill.
export function buildCapabilityRegistry(app) {
  const tools = [];
  const seen = new Set();

  for (const server of app.mcpServers()) {
    for (const tool of server.tools || []) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      tools.push({
        name: tool.name,
        description: tool.description || `Run the ${tool.name} tool.`,
        parameters: parseParameterSpec(tool.parameters),
        permission: isMutating(tool) ? 'approval-required' : 'read-only',
        execute: (args) => app.executeMcpTool(server.id, tool.name, args),
      });
    }
  }

  const coreExecutors = {
    diagnostics: () => app.diagnostics(),
    propose_workspace_edit: (args) => app.proposeWorkspaceEdit(args.path, args.content, args.reason),
  };
  for (const tool of app.tools || []) {
    const execute = coreExecutors[tool.id];
    if (!execute || seen.has(tool.id)) continue;
    seen.add(tool.id);
    tools.push({
      name: tool.id,
      description: tool.description,
      parameters: CORE_TOOL_SCHEMAS[tool.id] || { type: 'object', properties: {} },
      permission: CORE_TOOL_PERMISSIONS[tool.id] || 'approval-required',
      execute,
    });
  }

  // Skills are pre-authored and stored by the user, the same trust level as
  // typing their slash command directly — no approval gate beyond `enabled`.
  // If a skill's slugified name collides with an existing MCP or core tool,
  // the skill is skipped rather than shadowing it.
  for (const skill of app.skills() || []) {
    if (!skill.enabled) continue;
    const name = slugifyToolName(skill.slashCommand || skill.name);
    if (seen.has(name)) continue;
    seen.add(name);
    tools.push({
      name,
      description: skill.description ? `${skill.description} (same as typing ${skill.slashCommand})` : `Run the ${skill.slashCommand} skill.`,
      parameters: { type: 'object', properties: { input: { type: 'string', description: 'Arguments or query text for the skill, the same text that would follow the slash command.' } } },
      permission: 'read-only',
      execute: (args) => app.executeSkill(skill.id, args.input || ''),
    });
  }

  return tools;
}

// A short system-prompt addendum describing what's callable, so a model whose
// provider/template doesn't support structured tool-calling can still describe
// its own capabilities accurately instead of denying they exist.
export function describeCapabilities(tools) {
  if (!tools.length) return '';
  const lines = tools.map((tool) => `- ${tool.name}${tool.permission === 'approval-required' ? ' (requires user approval before it runs)' : ''}: ${tool.description}`);
  return `You have direct access to the following tools. Call one when it would answer the request more accurately than guessing from memory:\n${lines.join('\n')}`;
}
