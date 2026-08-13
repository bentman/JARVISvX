import path from 'node:path';

export class PolicyGate {
  constructor({ database } = {}) {
    this.database = database;
  }

  evaluate({ agent, requestedCapabilities = [], roots = [] }) {
    const agentCapabilities = new Set(agent.capabilities || ['workspace.read']);
    const effectiveCapabilities = requestedCapabilities.filter((cap) => agentCapabilities.has(cap));

    return {
      allowed: true,
      agentId: agent.id,
      effectiveCapabilities,
      requiresHumanApproval: effectiveCapabilities.includes('workspace.write') || effectiveCapabilities.includes('shell')
    };
  }

  validateWorkspacePath(targetPath, approvedRoots = []) {
    if (!approvedRoots.length) return false;
    const absolute = path.resolve(targetPath);
    return approvedRoots.some((root) => {
      const absRoot = path.resolve(root);
      return absolute === absRoot || absolute.startsWith(`${absRoot}${path.sep}`);
    });
  }
}
