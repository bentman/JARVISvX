import fs from 'node:fs/promises';
import path from 'node:path';

// The name field is display identity only — which CLI/adapter actually runs an
// agent is already shown by its own badge (see AgentOrchestrationView.tsx), so
// baking "(Claude Code)"/"(Codex)"/etc. into the name is redundant and, once CLI
// becomes a real editable selector, actively stale (the name wouldn't update
// when the CLI does). Kept out of `name` here for that reason.
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

// The full universe of selectable values for the Agent Profiles editor
// (AgentOrchestrationView.tsx) — every value used across DEFAULT_AGENT_PROFILES,
// so nothing in the defaults above can fall outside what the UI/validation allow.
export const AVAILABLE_ADAPTERS = ['acp', 'process'];
// CLIs AcpAdapter.buildCliArgs() (lib/agents/adapters/acp.mjs) actually knows how
// to build arguments for — the exhaustive, real "installed provider" list, not a
// guess. Adding CLI support there is what it would take to extend this list.
export const AVAILABLE_CLIS = ['claude', 'codex', 'copilot', 'cline', 'agy'];
// Matches PolicyGate's own vocabulary (lib/agents/policy.mjs): workspace.write and
// shell are the two privileged capabilities it gates behind human approval.
export const AVAILABLE_CAPABILITIES = ['workspace.read', 'workspace.write', 'git.read', 'shell'];
export const MAX_AGENT_NAME_LENGTH = 24;
export const MAX_AGENT_INSTRUCTIONS_LENGTH = 255;
export const MAX_AGENT_DESCRIPTION_LENGTH = 255;

const slugify = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '') || 'agent';

export class AgentRegistry {
  constructor({ database } = {}) {
    this.database = database;
    this.profiles = new Map(Object.entries(DEFAULT_AGENT_PROFILES));
  }

  async load(roots = []) {
    this.profiles = new Map(Object.entries(DEFAULT_AGENT_PROFILES));
    const searchPaths = roots.map((rootPath) => path.join(rootPath, '.jarvis', 'agents.json'));
    searchPaths.push(path.resolve('.jarvis', 'agents.json'));

    for (const filePath of searchPaths) {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.agents === 'object') {
          for (const [id, agent] of Object.entries(parsed.agents)) {
            this.profiles.set(id, {
              id,
              name: agent.name || id,
              description: agent.description || '',
              adapter: agent.adapter || 'acp',
              cli: agent.cli || agent.command || 'claude',
              command: agent.command || agent.cli || 'claude',
              voice: agent.voice || 'bf_isabella',
              capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : ['workspace.read'],
              instructions: agent.instructions || '',
              provider: agent.provider || null,  // optional: DB provider ID to pin this agent to
            });
          }
        }
      } catch {
        // File does not exist or invalid JSON; fallback to defaults
      }
    }
    return this;
  }

  get(agentId) {
    return this.profiles.get(agentId) || null;
  }

  // `isBuiltIn` tells the UI which cards may have their name/description/
  // instructions edited (custom agents only) versus only their runtime wiring
  // (adapter/cli/voice/capabilities — built-ins included, see updateAgent below).
  list() {
    return Array.from(this.profiles.values()).map((profile) => ({ ...profile, isBuiltIn: this.isBuiltIn(profile.id) }));
  }

  isBuiltIn(id) {
    return Object.prototype.hasOwnProperty.call(DEFAULT_AGENT_PROFILES, id);
  }

  // Custom agents (and built-in overrides) persist to <cwd>/.jarvis/agents.json —
  // the same file load() already reads, and per load()'s own precedence order
  // (workspace roots first, this cwd path last so it wins), this is the file that
  // always ends up authoritative. Writing anywhere else would silently lose to it.
  configPath() {
    return path.resolve('.jarvis', 'agents.json');
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

  // Creates a brand-new custom agent (the "add new one" half of the Agent
  // Profiles editor). Name/instructions are only ever settable here — updateAgent
  // never lets an existing agent's name change, so a new agent's identity is
  // fixed for good the moment it's created, same as the built-ins.
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

    const record = { id, name, description, adapter, cli, command: cli || adapter, voice, capabilities, instructions };
    const config = await this.readConfigFile();
    config.agents[id] = record;
    await this.writeConfigFile(config);
    this.profiles.set(id, record);
    return { ...record, isBuiltIn: false };
  }

  // Edits an existing agent's runtime wiring. Built-in agents (the seven roles
  // above) may only have adapter/cli/voice/capabilities changed — name,
  // description, and instructions define the role itself and stay fixed, same
  // reasoning as why createAgent never allows renaming after the fact. Custom
  // agents may have every field edited except id.
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
    if (patch.cli !== undefined) merged.command = patch.cli || merged.adapter;
    if (merged.adapter === 'acp' && !merged.cli) throw new Error('An ACP agent needs a CLI selected.');

    const config = await this.readConfigFile();
    config.agents[id] = merged;
    await this.writeConfigFile(config);
    this.profiles.set(id, merged);
    return { ...merged, isBuiltIn: builtIn };
  }

  // Deletes a custom agent. Built-ins are the fixed role set every other part of
  // the app (default agentId choices, tests, docs) assumes exists — removing one
  // is out of scope here, same boundary createAgent/updateAgent already draw.
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
