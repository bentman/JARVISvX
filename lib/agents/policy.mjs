import { ACTIONS, hasGrant } from '../authorization.mjs';
import { resolveWithinRoots } from '../tools.mjs';

// workspace.write and shell are the capabilities that give a run mutation authority.
const PRIVILEGED_CAPABILITIES = ['workspace.write', 'shell'];

// The narrowest process mode that still supports the effective capability set.
export const PROCESS_MODES = { readOnly: 'read-only', write: 'write', shell: 'shell' };

export function processModeFor(capabilities = []) {
  if (capabilities.includes('shell')) return PROCESS_MODES.shell;
  if (capabilities.includes('workspace.write')) return PROCESS_MODES.write;
  return PROCESS_MODES.readOnly;
}

export class PolicyGate {
  constructor({ database } = {}) {
    this.database = database;
  }

  evaluate({ agent, requestedCapabilities = [], authorization }) {
    const agentCaps = new Set(agent?.capabilities || ['workspace.read']);
    const missingCaps = requestedCapabilities.filter((cap) => !agentCaps.has(cap));

    if (missingCaps.length > 0) {
      return {
        allowed: false,
        agentId: agent?.id,
        reason: `Agent '${agent?.id}' lacks required capabilities: ${missingCaps.join(', ')}`,
        effectiveCapabilities: [],
        processMode: PROCESS_MODES.readOnly,
        requiresHumanApproval: false
      };
    }

    const effectiveCapabilities = requestedCapabilities.length
      ? requestedCapabilities
      : Array.from(agentCaps);

    const privilegedCaps = effectiveCapabilities.filter((c) => PRIVILEGED_CAPABILITIES.includes(c));
    const requiresHumanApproval = privilegedCaps.length > 0;

    if (requiresHumanApproval && !hasGrant(authorization, { action: ACTIONS.AGENT_PRIVILEGED, target: agent?.id })) {
      return {
        allowed: false,
        agentId: agent?.id,
        reason: `Agent '${agent?.id}' requested privileged capabilities (${privilegedCaps.join(', ')}) requiring human approval.`,
        effectiveCapabilities,
        processMode: processModeFor(effectiveCapabilities),
        requiresHumanApproval: true
      };
    }

    return {
      allowed: true,
      agentId: agent?.id,
      reason: 'Policy evaluation passed.',
      effectiveCapabilities,
      processMode: processModeFor(effectiveCapabilities),
      requiresHumanApproval: false
    };
  }

  // Agent workspace access resolves through the same real-path containment check
  // that the workspace tools use.
  async validateWorkspacePath(targetPath, approvedRoots = []) {
    try {
      await resolveWithinRoots(targetPath, approvedRoots, { mustExist: true });
      return true;
    } catch {
      return false;
    }
  }
}
