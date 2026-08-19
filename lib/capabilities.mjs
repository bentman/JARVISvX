// Builds the single set of invokable capabilities — workspace tools, every
// enabled MCP server's declared tools, every enabled skill, and agent
// delegation — that a model can call directly during conversation. The same
// registry backs autonomous tool-calling and the existing /slash matcher: a
// skill is reachable by typing `/calc` or by the model invoking it
// mid-conversation, through the same executeSkill() call either way (see
// docs/adr-0002-unified-capability-registry.md). The manual `@agent <id>
// <prompt>` entry point (bin/jarvis.mjs) is a separate, existing mechanism
// and is unchanged by this registry.

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
// tool name with two different execution paths), every enabled skill, and
// agent delegation. `context` carries the per-turn values (conversationId,
// allowCloud) that agent delegation's execute() needs at call time; it is
// not itself part of what the model can request.
export function buildCapabilityRegistry(app, context = {}) {
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

  // Agent delegation routes through the existing agent-bus tool surface
  // (lib/agents/agent-bus-mcp.mjs, already served at GET/POST
  // /api/agent-bus/*) rather than a new mechanism. agents_list only
  // enumerates agent profiles, so it is read-only; agents_ask starts a real
  // external CLI agent process (lib/agents/registry.mjs's adapters) and is
  // approval-required for every agent profile uniformly, regardless of that
  // profile's own declared capabilities — starting an external process is
  // a side effect in its own right. Once past that gate, the call passes
  // approved: true through to executeRun() so an agent whose own profile
  // requires workspace.write/shell (see lib/agents/policy.mjs) is satisfied
  // by the same approval instead of asking a second time. agents_send is
  // not included here: agents_ask doesn't resolve until the run it started
  // has finished (see RunCoordinator.executeRun), so by the time the model
  // sees a result, there is no still-running runId left for it to send a
  // follow-up to — agents_send only ever has something real to do when a
  // caller with live event-stream visibility (see AgentRuntime.sendToRun)
  // catches a runId while a run is still in flight.
  const agentProfiles = app.agents ? app.agents() : [];
  if (agentProfiles.length && !seen.has('agents_list')) {
    seen.add('agents_list');
    tools.push({
      name: 'agents_list',
      description: 'Lists available specialist agent profiles (id, description, capabilities, voice) that agents_ask can delegate to.',
      parameters: { type: 'object', properties: {} },
      permission: 'read-only',
      execute: () => app.executeAgentBusTool('agents_list', {}),
    });
  }
  if (agentProfiles.length && !seen.has('agents_ask')) {
    seen.add('agents_ask');
    tools.push({
      name: 'agents_ask',
      description: 'Delegates a specialized sub-task to a named agent identity, running it as a real external CLI agent. Call agents_list first to see available agent ids.',
      parameters: {
        type: 'object',
        properties: {
          targetAgentId: { type: 'string', description: 'An agent id from agents_list.', enum: agentProfiles.map((agent) => agent.id) },
          objective: { type: 'string', description: 'The sub-task to delegate to that agent.' },
        },
        required: ['targetAgentId', 'objective'],
      },
      permission: 'approval-required',
      execute: (args) => app.executeAgentBusTool(
        'agents_ask',
        { targetAgentId: args.targetAgentId, objective: args.objective },
        { conversationId: context.conversationId || null, allowCloud: Boolean(context.allowCloud), approved: true }
      ),
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
