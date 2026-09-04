// Model-callable capabilities combine core tools, enabled MCP tools and skills,
// and agent delegation. Slash commands, the direct testers, model invocation, and
// agent-bus invocation all resolve through these records and one policy check.
import { ACTIONS, authorize } from './authorization.mjs';

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

// Permissions the application declares for the tools it implements in-process
// (lib/mcp-skills.mjs). This is a statement about application-owned
// implementations, not an inference from how a server names its tools.
const APPLICATION_TOOL_PERMISSIONS = {
  read_workspace_file: 'read-only',
  list_workspace_directory: 'read-only',
  git_status: 'read-only',
  git_diff: 'read-only',
  execute_query: 'read-only',
  write_workspace_file: 'approval-required',
};

const isApplicationServer = (server) => server.type === 'built-in' || /^(workspace|sqlite):\/\//.test(server.endpoint || '');

// A tool is read-only only when an application-owned declaration says so. A tool
// declared by an external server carries no trusted metadata and stays gated.
function mcpPermission(server, tool) {
  if (!isApplicationServer(server)) return 'approval-required';
  return APPLICATION_TOOL_PERMISSIONS[tool.name] || 'approval-required';
}

// Provenance decides both the permission class and whether the model may call a
// skill without the operator naming it.
function skillPolicy(skill) {
  switch (skill.executionProvenance) {
    case 'application': return { permission: 'read-only', autonomous: true };
    case 'import_wrapper': return { permission: 'read-only', autonomous: true };
    default: return { permission: 'approval-required', autonomous: false };
  }
}

// The JSON Schema keywords provider tool-calling APIs accept. Anything else a
// server declares is reported on the record rather than dropped in silence.
const SUPPORTED_SCHEMA_KEYWORDS = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'additionalProperties']);
const SUPPORTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);

function convertSchema(schema, path, unsupported) {
  if (!schema || typeof schema !== 'object') return { type: 'string' };
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) unsupported.push(`${path}${path ? '.' : ''}${keyword}`);
  }
  const type = SUPPORTED_TYPES.has(schema.type) ? schema.type : 'string';
  if (schema.type && !SUPPORTED_TYPES.has(schema.type)) unsupported.push(`${path}${path ? '.' : ''}type=${schema.type}`);

  const converted = { type };
  if (schema.description) converted.description = schema.description;
  if (Array.isArray(schema.enum)) converted.enum = schema.enum;
  if (type === 'object') {
    converted.properties = Object.fromEntries(Object.entries(schema.properties || {})
      .map(([name, child]) => [name, convertSchema(child, `${path}${path ? '.' : ''}${name}`, unsupported)]));
    if (Array.isArray(schema.required) && schema.required.length) converted.required = schema.required;
  }
  if (type === 'array') converted.items = convertSchema(schema.items, `${path}${path ? '.' : ''}items`, unsupported);
  return converted;
}

const PARAMETERS_CACHE = new WeakMap();
const SPEC_CACHE = new Map();
const SKILL_PARAMETERS = Object.freeze({
  type: 'object',
  properties: { input: { type: 'string', description: 'Arguments or query text for the skill, the same text that would follow the slash command.' } }
});

// A discovered tool carries its own JSON Schema; the seeded built-ins carry the
// loose "name: type, name2?: type2" spec strings instead.
function toolParameters(tool) {
  if (tool && typeof tool === 'object') {
    const cached = PARAMETERS_CACHE.get(tool);
    if (cached) return cached;
  }
  let result;
  if (!tool.inputSchema) {
    result = { parameters: parseParameterSpec(tool.parameters), unsupported: [] };
  } else {
    const unsupported = [];
    const parameters = convertSchema({ type: 'object', properties: {}, ...tool.inputSchema }, '', unsupported);
    result = { parameters, unsupported };
  }
  if (tool && typeof tool === 'object') {
    PARAMETERS_CACHE.set(tool, result);
  }
  return result;
}

// Parses the loose "name: type, name2?: type2" spec strings the seeded built-in
// servers use (see lib/database.mjs) into a JSON Schema object shape. A trailing
// '?' on a parameter name marks it optional.
function parseParameterSpec(spec) {
  if (!spec || spec === 'none') return { type: 'object', properties: {} };
  const cached = SPEC_CACHE.get(spec);
  if (cached) return cached;
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
  const result = required.length ? { type: 'object', properties, required } : { type: 'object', properties };
  SPEC_CACHE.set(spec, result);
  return result;
}

// A skill's slashCommand (e.g. '/calc') isn't a valid tool name for most
// provider tool-calling APIs, which restrict names to [a-zA-Z0-9_-]. Strip
// the leading slash and replace anything else disallowed.
export const capabilityNameForSkill = (raw) => raw.replace(/^\//, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'skill';

// Every record's declared permission maps to the action the policy gates.
const actionFor = (record) => (record.permission === 'approval-required' ? ACTIONS.CAPABILITY_MUTATE : null);

// First registration wins, which gives every capability name one schema, one
// permission, and one execution path. Context carries the turn's authorization and
// is absent from model-controlled input.
export function buildCapabilityRecords(app, context = {}) {
  const records = [];
  const seen = new Set();
  const authorization = context.authorization;

  for (const server of app.mcpServers()) {
    for (const tool of server.tools || []) {
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      const { parameters, unsupported } = toolParameters(tool);
      records.push({
        name: tool.name,
        description: tool.description || `Run the ${tool.name} tool.`,
        parameters,
        permission: mcpPermission(server, tool),
        autonomous: true,
        // Declared schema features this conversion drops, so the gap is visible
        // rather than silent.
        unsupportedSchema: unsupported,
        run: (args) => app.executeMcpTool(server.id, tool.name, args, { authorization }),
      });
    }
  }

  const coreExecutors = {
    diagnostics: () => app.diagnostics(),
    propose_workspace_edit: (args) => app.proposeWorkspaceEdit(args.path, args.content, args.reason),
  };
  for (const tool of app.tools || []) {
    const run = coreExecutors[tool.id];
    if (!run || seen.has(tool.id)) continue;
    seen.add(tool.id);
    records.push({
      name: tool.id,
      description: tool.description,
      parameters: CORE_TOOL_SCHEMAS[tool.id] || { type: 'object', properties: {} },
      permission: CORE_TOOL_PERMISSIONS[tool.id] || 'approval-required',
      autonomous: true,
      run,
    });
  }

  // Enabled skills cannot shadow tools. Provenance, not enablement, decides trust.
  for (const skill of app.skills() || []) {
    if (!skill.enabled) continue;
    const name = capabilityNameForSkill(skill.slashCommand || skill.name);
    if (seen.has(name)) continue;
    seen.add(name);
    const policy = skillPolicy(skill);
    records.push({
      name,
      description: skill.description ? `${skill.description} (same as typing ${skill.slashCommand})` : `Run the ${skill.slashCommand} skill.`,
      parameters: SKILL_PARAMETERS,
      permission: policy.permission,
      autonomous: policy.autonomous,
      skillId: skill.id,
      run: (args) => app.executeSkill(skill.id, args.input || '', { authorization }),
    });
  }

  // agents_ask requires approval because it starts an external process. The turn's
  // authorization travels with the delegation instead of a hard-coded approval.
  const agentProfiles = app.agents ? app.agents() : [];
  if (agentProfiles.length && !seen.has('agents_list')) {
    seen.add('agents_list');
    records.push({
      name: 'agents_list',
      description: 'Lists available specialist agent profiles (id, description, capabilities, voice) that agents_ask can delegate to.',
      parameters: { type: 'object', properties: {} },
      permission: 'read-only',
      autonomous: true,
      run: () => app.executeAgentBusTool('agents_list', {}, { authorization }),
    });
  }
  if (agentProfiles.length && !seen.has('agents_ask')) {
    seen.add('agents_ask');
    records.push({
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
      autonomous: true,
      run: (args) => app.executeAgentBusTool(
        'agents_ask',
        { targetAgentId: args.targetAgentId, objective: args.objective },
        { conversationId: context.conversationId || null, authorization }
      ),
    });
  }

  // The decision and its audit record are made here, so every entry point that
  // runs a capability produces the same evidence.
  return records.map((record) => ({
    ...record,
    execute: (args) => {
      const action = actionFor(record);
      if (action) {
        try {
          authorize(authorization, { action, target: record.name });
        } catch (denial) {
          app.recordAuthorization?.({ context: authorization, action, target: record.name, granted: null, effective: null, outcome: 'denied' });
          throw denial;
        }
        app.recordAuthorization?.({ context: authorization, action, target: record.name, granted: record.name, effective: record.name, outcome: 'allowed' });
      }
      return record.run(args || {});
    },
  }));
}

// The model-facing view: capabilities the model may call without the operator
// naming them. Non-autonomous records stay reachable through executeCapability.
export function buildCapabilityRegistry(app, context = {}) {
  return buildCapabilityRecords(app, context).filter((record) => record.autonomous);
}

export function findCapability(app, name, context = {}) {
  return buildCapabilityRecords(app, context).find((record) => record.name === name) || null;
}

// The single dispatch entry point for slash invocation, the direct MCP and skill
// testers, and agent-bus invocation.
export async function executeCapability(app, name, args = {}, context = {}) {
  const record = findCapability(app, name, context);
  if (!record) { const error = new Error(`Unknown capability "${name}".`); error.code = 'not_found'; throw error; }
  return record.execute(args);
}

// Provider messages receive a human-readable summary alongside structured schemas.
export function describeCapabilities(tools) {
  if (!tools.length) return '';
  const lines = tools.map((tool) => `- ${tool.name}${tool.permission === 'approval-required' ? ' (requires user approval before it runs)' : ''}: ${tool.description}`);
  return `You have direct access to the following tools. Call one when it would answer the request more accurately than guessing from memory:\n${lines.join('\n')}`;
}
