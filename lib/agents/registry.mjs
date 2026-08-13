import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_AGENT_PROFILES = {
  architect: {
    id: 'architect',
    name: 'Architect (Claude Code)',
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
    name: 'Reviewer (Codex)',
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
    name: 'Builder (Claude Code)',
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
    name: 'Security (Copilot CLI)',
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
    name: 'Debugger (Cline CLI)',
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
    name: 'Researcher (Antigravity)',
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
    name: 'Adversary (Codex)',
    description: 'Presents counter-arguments using Codex CLI.',
    adapter: 'acp',
    cli: 'codex',
    command: 'codex',
    voice: 'af_bella',
    capabilities: ['workspace.read'],
    instructions: 'Challenge assumptions. Highlight hidden edge cases and failure modes.'
  }
};

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
              instructions: agent.instructions || ''
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

  list() {
    return Array.from(this.profiles.values());
  }
}
