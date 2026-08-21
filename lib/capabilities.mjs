// Model-callable capabilities combine core tools, enabled MCP tools and skills,
// and agent delegation. Slash commands and model-invoked skills share executeSkill().

// Core tools own fixed schemas; MCP schemas derive from declared parameter specs.
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

// propose_workspace_edit stages pending_review state; approval owns filesystem writes.
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

// First registration wins, which gives every tool name one execution path. Context
// carries trusted turn state for executors and is absent from model-controlled input.
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

  // Enabled skills have the same trust as direct slash invocation and cannot shadow tools.
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

  // agents_ask requires approval because it starts an external process; that approval
  // also satisfies the selected profile's privileged capabilities. agents_send remains
  // event-stream-only because agents_ask resolves after its run has completed.
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

// Provider messages receive a human-readable summary alongside structured schemas.
export function describeCapabilities(tools) {
  if (!tools.length) return '';
  const lines = tools.map((tool) => `- ${tool.name}${tool.permission === 'approval-required' ? ' (requires user approval before it runs)' : ''}: ${tool.description}`);
  return `You have direct access to the following tools. Call one when it would answer the request more accurately than guessing from memory:\n${lines.join('\n')}`;
}
