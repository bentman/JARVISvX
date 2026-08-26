import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAgentCommand } from './adapters/acp.mjs';
import { createRuntimePaths } from '../runtime-paths.mjs';

// Agent names are display identity; runtime CLI and adapter are separate.
export const DEFAULT_AGENT_PROFILES = {
  architect: {
    id: 'architect',
    name: 'Architect',
    description: 'Designs systems and identifies boundaries using Claude Code CLI.',
    adapter: 'acp',
    cli: 'claude',
    command: 'claude',
    voice: 'bm_george',
    capabilities: ['workspace.read', 'git.read'],
    instructions: 'Prefer simple, composable designs. Challenge unnecessary abstractions.'
  },
  reviewer: {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews implementation for correctness using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_sarah',
    capabilities: ['workspace.read', 'git.read'],
    instructions: 'Be skeptical. Cite concrete defects, performance bottlenecks, and avoid speculative changes.'
  },
  builder: {
    id: 'builder',
    name: 'Builder',
    description: 'Implements approved changes using Claude Code CLI.',
    adapter: 'acp',
    cli: 'claude',
    command: 'claude',
    voice: 'am_michael',
    capabilities: ['workspace.read', 'workspace.write', 'shell'],
    instructions: 'Implement the smallest complete change. Preserve existing conventions and formatting.'
  },
  security: {
    id: 'security',
    name: 'Security',
    description: 'Audits code for vulnerabilities using GitHub Copilot CLI.',
    adapter: 'acp',
    cli: 'copilot',
    command: 'copilot',
    voice: 'bm_lewis',
    capabilities: ['workspace.read'],
    instructions: 'Inspect privilege boundaries, input sanitization, data leaks, and strict authentication controls.'
  },
  debugger: {
    id: 'debugger',
    name: 'Debugger',
    description: 'Diagnoses runtime failures using Cline CLI.',
    adapter: 'acp',
    cli: 'cline',
    command: 'cline',
    voice: 'am_adam',
    capabilities: ['workspace.read', 'shell'],
    instructions: 'Analyze stack traces and root causes strictly based on empirical evidence.'
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    description: 'Surveys codebase documentation using Antigravity CLI.',
    adapter: 'process',
    cli: 'agy',
    command: 'agy',
    voice: 'bf_emma',
    capabilities: ['workspace.read'],
    instructions: 'Gather facts, synthesize documentation, and summarize findings clearly.'
  },
  adversary: {
    id: 'adversary',
    name: 'Adversary',
    description: 'Presents counter-arguments using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_bella',
    capabilities: ['workspace.read'],
    instructions: 'Challenge assumptions. Highlight hidden edge cases and failure modes.'
  }
};

// Editor options and backend validation draw from these sets.
export const AVAILABLE_ADAPTERS = ['acp', 'process'];
// Each selectable CLI requires a corresponding AcpAdapter argument mapping.
export const AVAILABLE_CLIS = ['claude', 'codex', 'copilot', 'cline', 'agy'];
// Matches PolicyGate's own vocabulary (lib/agents/policy.mjs): workspace.write and
// shell are the two privileged capabilities it gates behind human approval.
export const AVAILABLE_CAPABILITIES = ['workspace.read', 'workspace.write', 'git.read', 'shell'];
export const MAX_AGENT_NAME_LENGTH = 24;
export const MAX_AGENT_INSTRUCTIONS_LENGTH = 255;
export const MAX_AGENT_DESCRIPTION_LENGTH = 255;

const slugify = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'agent';

// Executable wiring is application-owned: a CLI identifier selects its command.
export const COMMAND_FOR_CLI = { claude: 'claude', codex: 'codex', copilot: 'copilot', cline: 'cline', agy: 'agy' };

// Fields an override may set. Process arguments and anything else outside this
// list are rejected; `command` follows the CLI identifier rather than the file.
const OVERRIDE_FIELDS = new Set(['id', 'name', 'description', 'adapter', 'cli', 'command', 'voice', 'capabilities', 'instructions', 'provider']);

export class AgentRegistry {
  constructor({ database, configPath = createRuntimePaths().agentConfigPath } = {}) {
    this.database = database;
    this.agentConfigPath = configPath;
    this.profiles = new Map(Object.entries(DEFAULT_AGENT_PROFILES));
    this.rejections = [];
  }

  // A profile is validated against application-owned allowlists before it enters
  // the registry, so an override customizes identity and capabilities without
  // naming what runs.
  validateProfile(id, agent, { filePath }) {
    const unknown = Object.keys(agent).filter((key) => !OVERRIDE_FIELDS.has(key));
    if (unknown.length) throw new Error(`${filePath}: profile "${id}" sets field(s) outside its scope: ${unknown.join(', ')}.`);

    const adapter = agent.adapter || 'acp';
    if (!AVAILABLE_ADAPTERS.includes(adapter)) throw new Error(`${filePath}: profile "${id}" names unknown adapter "${adapter}".`);

    const cli = agent.cli || agent.command || 'claude';
    if (!AVAILABLE_CLIS.includes(cli)) throw new Error(`${filePath}: profile "${id}" names unknown CLI "${cli}".`);

    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : ['workspace.read'];
    const invalidCaps = capabilities.filter((capability) => !AVAILABLE_CAPABILITIES.includes(capability));
    if (invalidCaps.length) throw new Error(`${filePath}: profile "${id}" names unknown capabilit${invalidCaps.length === 1 ? 'y' : 'ies'}: ${invalidCaps.join(', ')}.`);

    const command = COMMAND_FOR_CLI[cli];
    if (agent.command !== undefined && agent.command !== command) {
      throw new Error(`${filePath}: profile "${id}" sets command "${agent.command}", which is not the command for CLI "${cli}".`);
    }

    return {
      id,
      name: agent.name || id,
      description: agent.description || '',
      adapter,
      cli,
      command,
      voice: agent.voice || 'bf_isabella',
      capabilities,
      instructions: agent.instructions || '',
      provider: agent.provider || null,  // optional: DB provider ID to pin this agent to
    };
  }

  // Built-in profiles are the defaults; the override file is the only source
  // that changes them, so a profile's executable wiring never comes from a
  // directory the operator merely approved for reading.
  async load() {
    this.profiles = new Map(Object.entries(DEFAULT_AGENT_PROFILES));
    this.rejections = [];
    const filePath = this.configPath();

    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch {
      return this;  // Missing or unreadable overrides leave the defaults in place.
    }
    if (!parsed || typeof parsed.agents !== 'object' || parsed.agents === null) return this;

    for (const [id, agent] of Object.entries(parsed.agents)) {
      try {
        this.profiles.set(id, this.validateProfile(id, agent || {}, { filePath }));
      } catch (error) {
        this.rejections.push({ filePath, profileId: id, reason: error.message });
      }
    }
    return this;
  }

  get(agentId) {
    return this.profiles.get(agentId) || null;
  }

  // Built-in identity fields are fixed; runtime wiring remains editable. A profile
  // that shells out is usable only where its CLI exists for the running session.
  list() {
    return Array.from(this.profiles.values()).map((profile) => ({ ...profile, isBuiltIn: this.isBuiltIn(profile.id), ...this.availability(profile) }));
  }

  availability(profile) {
    if (profile.adapter !== 'acp') return { available: true, unavailableReason: null };
    const resolved = resolveAgentCommand(profile.command);
    return { available: resolved.available, unavailableReason: resolved.available ? null : resolved.reason };
  }

  isBuiltIn(id) {
    return Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_PROFILES, id);
  }

  configPath() {
    return this.agentConfigPath;
  }

  async readConfigFile() {
    try {
      const raw = await fs.readFile(this.configPath(), 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.agents === 'object' && parsed.agents !== null ? parsed : { agents: {} };
    } catch {
      return { agents: {} };
    }
  }

  async writeConfigFile(config) {
    const filePath = this.configPath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }

  validateFields({ name, description, instructions, adapter, cli, capabilities }) {
    if (name !== undefined) {
      if (!String(name).trim()) throw new Error('Agent name is required.');
      if (name.length > MAX_AGENT_NAME_LENGTH) throw new Error(`Agent name must be ${MAX_AGENT_NAME_LENGTH} characters or fewer.`);
    }
    if (description !== undefined && description.length > MAX_AGENT_DESCRIPTION_LENGTH) {
      throw new Error(`Description must be ${MAX_AGENT_DESCRIPTION_LENGTH} characters or fewer.`);
    }
    if (instructions !== undefined && instructions.length > MAX_AGENT_INSTRUCTIONS_LENGTH) {
      throw new Error(`Instructions must be ${MAX_AGENT_INSTRUCTIONS_LENGTH} characters or fewer.`);
    }
    if (adapter !== undefined && !AVAILABLE_ADAPTERS.includes(adapter)) {
      throw new Error(`Unknown adapter "${adapter}". Available adapters: ${AVAILABLE_ADAPTERS.join(', ')}.`);
    }
    if (cli !== undefined && cli !== null && !AVAILABLE_CLIS.includes(cli)) {
      throw new Error(`Unknown CLI "${cli}". Available CLIs: ${AVAILABLE_CLIS.join(', ')}.`);
    }
    if (capabilities !== undefined) {
      if (!Array.isArray(capabilities)) throw new Error('Capabilities must be a list.');
      const invalid = capabilities.filter((c) => !AVAILABLE_CAPABILITIES.includes(c));
      if (invalid.length) throw new Error(`Unknown capabilit${invalid.length === 1 ? 'y' : 'ies'}: ${invalid.join(', ')}. Available: ${AVAILABLE_CAPABILITIES.join(', ')}.`);
    }
  }

  async createAgent(profile = {}) {
    const name = String(profile.name || '').trim();
    const description = String(profile.description || '').slice(0, MAX_AGENT_DESCRIPTION_LENGTH);
    const instructions = String(profile.instructions || '');
    const adapter = profile.adapter || 'acp';
    const cli = profile.cli || profile.command || null;
    const voice = profile.voice || 'bf_isabella';
    const capabilities = Array.isArray(profile.capabilities) && profile.capabilities.length ? profile.capabilities : ['workspace.read'];

    this.validateFields({ name, description, instructions, adapter, cli, capabilities });
    if (adapter === 'acp' && !cli) throw new Error('An ACP agent needs a CLI selected.');

    let id = slugify(name);
    if (this.profiles.has(id)) {
      let n = 2;
      while (this.profiles.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }

    const record = { id, name, description, adapter, cli, command: COMMAND_FOR_CLI[cli] || cli, voice, capabilities, instructions };
    const config = await this.readConfigFile();
    config.agents[id] = record;
    await this.writeConfigFile(config);
    this.profiles.set(id, record);
    return { ...record, isBuiltIn: false };
  }

  // Built-in profiles expose runtime wiring; custom profiles expose every field but ID.
  async updateAgent(id, patch = {}) {
    const current = this.profiles.get(id);
    if (!current) { const err = new Error(`Agent "${id}" not found.`); err.code = 'not_found'; throw err; }

    const builtIn = this.isBuiltIn(id);
    const editableFields = builtIn
      ? ['adapter', 'cli', 'voice', 'capabilities']
      : ['name', 'description', 'adapter', 'cli', 'voice', 'capabilities', 'instructions'];
    const rejected = Object.keys(patch).filter((key) => !editableFields.includes(key));
    if (rejected.length) {
      throw new Error(builtIn
        ? `"${current.name}" is a built-in role — only ${editableFields.join(', ')} can be changed (not ${rejected.join(', ')}).`
        : `Unsupported field(s): ${rejected.join(', ')}.`);
    }

    this.validateFields(patch);
    const merged = { ...current, ...patch };
    delete merged.isBuiltIn;
    if (patch.cli !== undefined) merged.command = COMMAND_FOR_CLI[patch.cli] || patch.cli;
    if (merged.adapter === 'acp' && !merged.cli) throw new Error('An ACP agent needs a CLI selected.');

    const config = await this.readConfigFile();
    config.agents[id] = merged;
    await this.writeConfigFile(config);
    this.profiles.set(id, merged);
    return { ...merged, isBuiltIn: builtIn };
  }

  // Built-in profiles form the fixed role set and cannot be deleted.
  async deleteAgent(id) {
    if (this.isBuiltIn(id)) throw new Error(`"${this.get(id)?.name || id}" is a built-in role and cannot be deleted.`);
    if (!this.profiles.has(id)) { const err = new Error(`Agent "${id}" not found.`); err.code = 'not_found'; throw err; }

    const config = await this.readConfigFile();
    delete config.agents[id];
    await this.writeConfigFile(config);
    this.profiles.delete(id);
    return { removed: true };
  }
}
