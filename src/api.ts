import type { AgentEditorOptions, AgentProfile, AgentRun, Conversation, Diagnostics, EffectiveSettings, HardwareProfile, McpServer, McpTool, MemoryItem, ModelConfig, Provider, ProviderProtocol, ProviderRecord, ProviderTestResult, Root, SkillExport, SkillModule, VoiceRuntimeStatus, WorkspaceEdit } from './types';

declare global {
  interface Window {
    jarvisDesktop?: {
      daemon: () => Promise<{ port: number; token: string }>;
      voice: (action: string, payload?: unknown) => Promise<unknown>;
      tts: (action: string, payload?: unknown) => Promise<{ ok?: boolean; cancelled?: boolean; stage?: string; error?: string; samples: Float32Array; sampleRate: number }>;
      onTtsProgress?: (callback: (payload: { id?: number; stage?: string; message?: string }) => void) => () => void;
    };
  }
}

let daemon: { port: number; token: string } | null = null;

const setupDaemon = async () => {
  if (!daemon) {
    if (window.jarvisDesktop) {
      try { daemon = await window.jarvisDesktop.daemon(); } catch {}
    }
    if (!daemon) {
      try {
        const res = await fetch('/api/session');
        if (res.ok) daemon = await res.json();
      } catch {}
    }
  }
  return daemon;
};

const getBaseUrl = (config: { port?: number; token?: string } | null) => (config && typeof config.port === 'number' && config.port > 0 ? `http://127.0.0.1:${config.port}` : '');

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const body = await response.text().catch(() => '');
  const preview = body.trim().replace(/\s+/g, ' ').slice(0, 160);
  throw new Error(preview ? `Expected JSON but received ${contentType || 'unknown content'}: ${preview}` : `Expected JSON but received ${contentType || 'unknown content'}.`);
};

// Every request is bounded, and the bound reaches the underlying fetch rather
// than abandoning a request that keeps running.
const REQUEST_TIMEOUT_MS = 30_000;

// Equivalent concurrent reads share one request. Only GETs qualify: a mutation
// must reach the daemon once per call.
const inFlight = new Map<string, Promise<unknown>>();

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const config = await setupDaemon();
  const baseUrl = getBaseUrl(config);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const response = await fetch(`${baseUrl}${url}`, {
    ...options,
    signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    headers: { 'content-type': 'application/json', ...(config?.token ? { 'x-jarvis-token': config.token } : {}), ...options?.headers }
  });
  if (!response.ok) {
    const body: { error?: string } = await parseJsonResponse<{ error?: string }>(response).catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : parseJsonResponse<T>(response);
};

const json = <T>(url: string, options?: RequestInit): Promise<T> => {
  // A caller-supplied signal makes the request cancellable on its own terms, so
  // it is never shared with another caller.
  if ((options?.method || 'GET') !== 'GET' || options?.signal) return request<T>(url, options);
  const shared = inFlight.get(url);
  if (shared) return shared as Promise<T>;
  const pending = request<T>(url, options).finally(() => { inFlight.delete(url); });
  inFlight.set(url, pending);
  return pending as Promise<T>;
};

export type ApprovalAction = 'provider.cloud' | 'capability.mutate' | 'agent.privileged' | 'workspace.write';

export const api = {
  // Approval is a daemon record for one exact operation. A control submits the
  // grant id it receives here; a request flag never carries authority on its own.
  requestApproval: (action: ApprovalAction, target: string) => json<{ id: string; action: string; target: string; expiresAt: string }>('/api/approvals', { method: 'POST', body: JSON.stringify({ action, target }) }),

  // /providers supplies the bootstrap health and settings shape.
  providerHealth: () => json<{ settings: EffectiveSettings; providers: Provider[] }>('/api/providers'),
  models: (provider?: string, signal?: AbortSignal) => json<{ provider: string; models: string[] }>(`/api/models${provider ? `?provider=${encodeURIComponent(provider)}` : ''}`, signal ? { signal } : undefined),

  // Registry CRUD uses /provider-registry to preserve the /providers response contract.
  providers: () => json<ProviderRecord[]>('/api/provider-registry'),
  addProvider: (data: Partial<ProviderRecord> & { api_key?: string }) => json<ProviderRecord>('/api/provider-registry', { method: 'POST', body: JSON.stringify(data) }),
  updateProvider: (id: string, data: Partial<ProviderRecord> & { api_key?: string }) => json<ProviderRecord>(`/api/provider-registry/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProvider: (id: string) => json<{ removed: boolean }>(`/api/provider-registry/${id}`, { method: 'DELETE' }),
  testProvider: (id: string) => json<ProviderTestResult>(`/api/provider-registry/${id}/test`, { method: 'POST', body: '{}' }),
  toggleProvider: (id: string) => json<ProviderRecord>(`/api/provider-registry/${id}/toggle`, { method: 'POST', body: '{}' }),
  probeProviderModels: (data: { protocol: ProviderProtocol; baseUrl: string; apiKey?: string }) =>
    json<{ available: boolean; models: string[]; reason?: string }>('/api/provider-registry/probe', { method: 'POST', body: JSON.stringify(data) }),
  diagnostics: (signal?: AbortSignal) => json<Diagnostics>('/api/diagnostics', signal ? { signal } : undefined),
  voice: () => json<VoiceRuntimeStatus>('/api/voice'),
  bootstrapVoice: (id: string) => json(`/api/voice/bootstrap/${id}`, { method: 'POST', body: '{}' }),
  setListening: (enabled: boolean) => json<void>('/api/voice/enabled', { method: 'POST', body: JSON.stringify({ enabled }) }),
  setVoiceMode: (mode: string) => json<void>('/api/voice/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  setVoice: (voice: string) => json<void>('/api/voice/voice', { method: 'POST', body: JSON.stringify({ voice }) }),
  setVoiceState: (state: string, detail?: string) => json<void>('/api/voice/state', { method: 'POST', body: JSON.stringify({ state, detail }) }),
  voiceTranscript: (kind: 'partial' | 'final', text: string, conversationId?: string) => json<{ accepted: boolean }>('/api/voice/transcript', { method: 'POST', body: JSON.stringify({ kind, text, conversationId }) }),
  voiceEvent: (event: Record<string, unknown>) => json<{ accepted: boolean }>('/api/voice/event', { method: 'POST', body: JSON.stringify(event) }),
  conversations: () => json<Conversation[]>('/api/conversations'),
  conversation: (id: string) => json<Conversation>(`/api/conversations/${id}`),
  createConversation: () => json<Conversation>('/api/conversations', { method: 'POST', body: '{}' }),
  deleteConversation: (id: string) => json<{ removed: boolean }>(`/api/conversations/${id}`, { method: 'DELETE' }),
  roots: () => json<Root[]>('/api/workspace-roots'),
  addRoot: (path: string) => json<Root>('/api/workspace-roots', { method: 'POST', body: JSON.stringify({ path }) }),
  removeRoot: (id: string) => json<{ removed: boolean }>(`/api/workspace-roots/${id}`, { method: 'DELETE' }),
  workspaceEdits: (status?: string) => json<WorkspaceEdit[]>(`/api/workspace-edits${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  proposeWorkspaceEdit: (data: { path: string; content: string; reason?: string }) => json<WorkspaceEdit>('/api/workspace-edits/propose', { method: 'POST', body: JSON.stringify(data) }),
  approveWorkspaceEdit: (id: string) => json<WorkspaceEdit>(`/api/workspace-edits/${id}/approve`, { method: 'POST', body: '{}' }),
  rejectWorkspaceEdit: (id: string) => json<WorkspaceEdit>(`/api/workspace-edits/${id}/reject`, { method: 'POST', body: '{}' }),
  setModel: (provider: string, model: string) => json<void>('/api/settings/model', { method: 'POST', body: JSON.stringify({ provider, model }) }),
  // Effective settings combine provider priority, model choice, and routing mode.
  effectiveSettings: () => json<EffectiveSettings>('/api/settings/effective'),
  cancel: (id: string, turnId?: string) => json<{ cancelled: boolean }>(`/api/chat/${id}/cancel`, { method: 'POST', body: JSON.stringify({ turnId }) }),

  // MCP Servers API
  mcpServers: () => json<{ servers: McpServer[] }>('/api/mcp'),
  addMcpServer: (data: { name: string; type?: string; endpoint: string; tools?: McpTool[] }) => json<McpServer>('/api/mcp', { method: 'POST', body: JSON.stringify(data) }),
  pingMcpServer: (id: string) => json<{ status: 'unknown' | 'connected' | 'error'; latencyMs: number | null; failureReason: string | null }>(`/api/mcp/${id}/ping`, { method: 'POST', body: '{}' }),
  executeMcpTool: (id: string, toolName: string, params: Record<string, unknown> = {}, approvals: string[] = []) => json<{ success: boolean; tool: string; output: string; durationMs: number }>(`/api/mcp/${id}/tools/${toolName}/execute`, { method: 'POST', body: JSON.stringify({ ...params, approvals }) }),
  deleteMcpServer: (id: string) => json<{ removed: boolean }>(`/api/mcp/${id}`, { method: 'DELETE' }),

  // Model Orchestration API
  orchestration: () => json<{ settings: ModelConfig; hardware: HardwareProfile }>('/api/orchestration'),
  updateOrchestration: (data: Partial<ModelConfig>) => json<ModelConfig>('/api/orchestration', { method: 'POST', body: JSON.stringify(data) }),
  pingLocalEndpoint: (endpoint?: string) => json<{ status: string; latencyMs: number; endpoint: string; models: string[] }>('/api/orchestration/ping-endpoint', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  hardwareProfile: () => json<HardwareProfile>('/api/orchestration/hardware'),

  // Slash Skills API
  skills: () => json<SkillModule[]>('/api/skills'),
  addSkill: (data: Partial<SkillModule>) => json<SkillModule>('/api/skills', { method: 'POST', body: JSON.stringify(data) }),
  updateSkill: (id: string, data: Partial<SkillModule>) => json<SkillModule>(`/api/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteSkill: (id: string) => json<{ removed: boolean }>(`/api/skills/${id}`, { method: 'DELETE' }),
  toggleSkill: (id: string) => json<SkillModule>(`/api/skills/${id}/toggle`, { method: 'POST', body: '{}' }),
  executeSkill: (idOrCommand: string, input: string = '', approvals: string[] = []) => json<{ success: boolean; slashCommand: string; skillName: string; output: string; durationMs: number }>(`/api/skills/execute`, { method: 'POST', body: JSON.stringify({ command: idOrCommand, input, approvals }) }),
  // Skill import accepts repository coordinates or GitHub URLs; export returns SKILL.md.
  importSkill: (source: string) => json<SkillModule>('/api/skills/import', { method: 'POST', body: JSON.stringify({ source }) }),
  exportSkill: (id: string) => json<SkillExport>(`/api/skills/${id}/export`),
  // Memory Center API
  memories: (category?: string) => json<MemoryItem[]>(`/api/memory${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  addMemory: (data: Partial<MemoryItem>) => json<MemoryItem>('/api/memory', { method: 'POST', body: JSON.stringify(data) }),
  updateMemory: (id: string, data: Partial<MemoryItem>) => json<MemoryItem>(`/api/memory/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMemory: (id: string) => json<{ removed: boolean }>(`/api/memory/${id}`, { method: 'DELETE' }),
  searchMemories: (query: string, category?: string) => json<MemoryItem[]>('/api/memory/search', { method: 'POST', body: JSON.stringify({ query, category }) }),
  // Agent Runtime API
  agents: () => json<AgentProfile[]>('/api/agents'),
  agent: (id: string) => json<AgentProfile>(`/api/agents/${id}`),
  agentEditorOptions: () => json<AgentEditorOptions>('/api/agents/editor-options'),
  createAgent: (profile: Partial<AgentProfile>) => json<AgentProfile>('/api/agents', { method: 'POST', body: JSON.stringify(profile) }),
  updateAgent: (id: string, patch: Partial<AgentProfile>) => json<AgentProfile>(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteAgent: (id: string) => json<{ removed: boolean }>(`/api/agents/${id}`, { method: 'DELETE' }),
  executeAgentRun: (options: { agentId?: string; agentIds?: string[]; objective: string; mode?: 'solo' | 'delegate' | 'panel' | 'debate'; conversationId?: string; requestedCapabilities?: string[]; approvals?: string[] }) => json<AgentRun>('/api/agents/run', { method: 'POST', body: JSON.stringify(options) }),
  agentRuns: (conversationId?: string) => json<AgentRun[]>(`/api/runs${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''}`),

  autoSummarizeMemory: () => json<{ addedCount: number; totalMemories: number }>('/api/memory/auto-summarize', { method: 'POST', body: '{}' }),

  async *events(signal?: AbortSignal) {
    const config = await setupDaemon();
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/api/events`, { headers: config?.token ? { 'x-jarvis-token': config.token } : {}, signal });
    if (!response.ok || !response.body) throw new Error('Unable to open assistant event stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) return;
      buffer += decoder.decode(value, { stream: true }); const chunks = buffer.split('\n\n'); buffer = chunks.pop() || '';
      for (const chunk of chunks) { const row = chunk.split('\n').find((line) => line.startsWith('data:')); if (row) yield JSON.parse(row.slice(5)); }
    }
  },
  async streamChat(payload: Record<string, unknown>, onEvent: (event: any) => void) {
    const config = await setupDaemon();
    const baseUrl = getBaseUrl(config);
    const response = await fetch(`${baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(config?.token ? { 'x-jarvis-token': config.token } : {}) }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error((await parseJsonResponse<{ error?: string }>(response).catch(() => null))?.error || `Request failed (${response.status})`);
    if (!response.body) throw new Error('Unable to open response stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const chunks = buffer.split('\n\n'); buffer = chunks.pop() || '';
      for (const chunk of chunks) { const row = chunk.split('\n').find((line) => line.startsWith('data:')); if (row) onEvent(JSON.parse(row.slice(5))); }
    }
  },
  async voiceAssetBase() {
    const config = await setupDaemon();
    const baseUrl = getBaseUrl(config);
    return `${baseUrl || window.location.origin}/api/voice-assets`;
  }
};
