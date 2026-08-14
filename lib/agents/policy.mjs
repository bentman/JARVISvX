import path from 'node:path';

export class PolicyGate {
  constructor({ database } = {}) {
    this.database = database;
  }

  evaluate({ agent, requestedCapabilities = [], approved = false }) {
    const agentCaps = new Set(agent?.capabilities || ['workspace.read']);
    const missingCaps = requestedCapabilities.filter((cap) => !agentCaps.has(cap));

    if (missingCaps.length > 0) {
      return {
        allowed: false,
        agentId: agent?.id,
        reason: `Agent '${agent?.id}' lacks required capabilities: ${missingCaps.join(', ')}`,
        effectiveCapabilities: [],
        requiresHumanApproval: false
      };
    }

    const effectiveCapabilities = requestedCapabilities.length
      ? requestedCapabilities
      : Array.from(agentCaps);

    const privilegedCaps = effectiveCapabilities.filter((c) => c === 'workspace.write' || c === 'shell');
    const requiresHumanApproval = privilegedCaps.length > 0;

    if (requiresHumanApproval && !approved) {
      return {
        allowed: false,
        agentId: agent?.id,
        reason: `Agent '${agent?.id}' requested privileged capabilities (${privilegedCaps.join(', ')}) requiring human approval.`,
        effectiveCapabilities,
        requiresHumanApproval: true
      };
    }

    return {
      allowed: true,
      agentId: agent?.id,
      reason: 'Policy evaluation passed.',
      effectiveCapabilities,
      requiresHumanApproval: false
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
