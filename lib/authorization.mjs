import crypto from 'node:crypto';

// Action classes gated by the daemon. Every side effect and cloud transmission
// names one of these before it executes.
export const ACTIONS = {
  CLOUD: 'provider.cloud',
  CAPABILITY_MUTATE: 'capability.mutate',
  AGENT_PRIVILEGED: 'agent.privileged',
};

// A grant is bound to the target the operator selected. These two sentinels are
// the selection an operator makes when the concrete target is chosen by routing
// or by the model inside the approved turn; single use and expiry still bound them.
const ROUTED_TARGET = 'auto';
const ANY_TARGET = 'any';

const DENIALS = {
  [ACTIONS.CLOUD]: { code: 'cloud_approval_required', message: 'Cloud requests require explicit approval.' },
  [ACTIONS.CAPABILITY_MUTATE]: { code: 'approval_required', message: 'This capability changes state and requires approval before it runs.' },
  [ACTIONS.AGENT_PRIVILEGED]: { code: 'approval_required', message: 'Privileged agent capabilities require approval before the agent runs.' },
};

const GRANT_TTL_MS = 120_000;


export class AuthorizationError extends Error {
  constructor(message, code = 'policy_denied', actionClass = null) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
    this.actionClass = actionClass;
  }
}

const KNOWN_ACTIONS = new Set(Object.values(ACTIONS));
const isKnownAction = (action) => KNOWN_ACTIONS.has(action);

// The turn context is immutable: an adapter, skill body, MCP transport, or client
// cannot add authority to a turn that is already running.
export function createTurnAuthorization({ grants = [], origin = null } = {}) {
  const entries = grants.map((grant) => {
    if (!isKnownAction(grant?.action)) throw new AuthorizationError(`Unknown authorization action '${grant?.action}'.`, 'policy_denied', null);
    return Object.freeze({ action: grant.action, target: grant.target == null ? ANY_TARGET : String(grant.target) });
  });
  return Object.freeze({
    id: crypto.randomUUID(),
    origin,
    createdAt: new Date().toISOString(),
    grants: Object.freeze(entries),
  });
}

export const EMPTY_AUTHORIZATION = createTurnAuthorization();

function matches(grant, action, target) {
  if (grant.action !== action) return false;
  if (grant.target === ANY_TARGET) return true;
  if (action === ACTIONS.CLOUD && grant.target === ROUTED_TARGET) return true;
  return grant.target === String(target);
}

export function hasAnyGrant(context, action) {
  return Boolean(context?.grants?.some((grant) => grant.action === action));
}

export function hasGrant(context, { action, target }) {
  return Boolean(context?.grants?.some((grant) => matches(grant, action, target)));
}

// The one policy decision mechanism. Entry points call it before execution and
// let the typed denial propagate; they do not translate it into a success shape.
export function authorize(context, { action, target = ANY_TARGET }) {
  if (!isKnownAction(action)) throw new AuthorizationError(`Unknown authorization action '${action}'.`, 'policy_denied', null);
  if (hasGrant(context, { action, target })) return true;
  const denial = DENIALS[action];
  throw new AuthorizationError(denial.message, denial.code, action);
}

// Daemon-owned approval records. A grant is issued for one exact operation,
// consumed once, and expires without reuse; a request boolean never substitutes.
export class GrantLedger {
  constructor({ database, ttlMs = GRANT_TTL_MS } = {}) {
    this.database = database;
    this.ttlMs = ttlMs;
  }

  issue({ action, target = ANY_TARGET, requested = null }) {
    if (!isKnownAction(action)) throw new AuthorizationError(`Unknown authorization action '${action}'.`, 'policy_denied', null);
    return this.database.issueGrant({
      id: crypto.randomUUID(),
      action,
      target: String(target),
      requested: requested || action,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
    });
  }

  consume(id) {
    const grant = this.database.consumeGrant(id, new Date().toISOString());
    if (!grant) throw new AuthorizationError('No usable daemon approval for this operation.', 'approval_required', null);
    return { action: grant.action, target: grant.target };
  }

  // Requested, granted, effective, and denial are recorded separately. Provider
  // keys, daemon tokens, prompts, and skill source are never authorization evidence.
  record({ context = null, action, target = ANY_TARGET, granted, effective = null, outcome }) {
    this.database.recordAuthorization({
      id: crypto.randomUUID(),
      turnId: context?.id || null,
      origin: context?.origin || null,
      action,
      requestedTarget: String(target),
      grantedTarget: granted == null ? null : String(granted),
      effectiveTarget: effective == null ? null : String(effective),
      outcome,
    });
  }
}
