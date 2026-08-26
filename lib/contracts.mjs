// Status vocabularies and error codes shared by persistence, HTTP, and the
// client types. This module is the authoritative definition; `src/types.ts`
// mirrors it and a test asserts the two stay in step.

export const WORKSPACE_EDIT_STATES = ['pending_review', 'approved_and_applied', 'rejected'];

// A reviewed edit is terminal: re-approving or re-rejecting it is a conflict.
export const WORKSPACE_EDIT_TRANSITIONS = {
  pending_review: ['approved_and_applied', 'rejected'],
  approved_and_applied: [],
  rejected: [],
};

export const MCP_HEALTH_STATES = ['unknown', 'connected', 'error'];

// Every typed failure an API consumer can receive, and the status it maps to.
export const API_ERROR_STATUS = {
  not_found: 404,
  conflict: 409,
  validation: 400,
  approval_required: 403,
  policy_denied: 403,
  cloud_approval_required: 403,
  unsupported_policy: 403,
  provider_disabled: 400,
  unknown_provider: 400,
  unknown_agent: 400,
  not_ready: 503,
};

export function canTransition(from, to) {
  return (WORKSPACE_EDIT_TRANSITIONS[from] || []).includes(to);
}
