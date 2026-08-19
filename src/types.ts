export type ProviderProtocol = 'openai-compat' | 'ollama' | 'anthropic' | 'gemini' | 'azure-openai';
export type ProviderTag = 'local' | 'cloud' | 'fast' | 'reasoning' | 'vision' | 'coding';

// Returned by GET /api/providers (health-checked) — includes tags/priority so the UI
// can tell a cloud-tagged provider from a local one without relying on a fixed id.
export type Provider = { id: string; label: string; available: boolean; models: string[]; reason?: string; tags?: ProviderTag[]; priority?: number };

export interface ProviderRecord {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  base_url: string;
  model: string;
  api_key_set: boolean;
  tags: ProviderTag[];
  enabled: boolean;
  priority: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProviderTestResult {
  id: string;
  label: string;
  available: boolean;
  models: string[];
  latencyMs?: number;
  reason?: string;
}

// `reasoning` is a client-only, in-memory field for live chain-of-thought display
// (see the 'reasoning' SSE event in api.streamChat). It is never persisted by the
// daemon and will not be present on messages loaded from conversation history —
// by design, reasoning is viewable while streaming, not part of the logged transcript.
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; reasoning?: string; provider?: string; status: string; created_at: string };
export type Conversation = { id: string; title: string; created_at: string; updated_at: string; messages?: Message[] };
export type Root = { id: string; path: string; added_at: string };
export type Diagnostics = { generatedAt: string; system: { platform: string; arch: string; release: string; cpu: { model: string; speed: number }[]; memory: { total: number; free: number } }; acceleration: { status: string; reason?: string; gpus?: { name: string; memoryBytes: number | null; memorySource: string; memoryReason?: string }[]; npu?: { status: string; name?: string; reason?: string } }; providers: Provider[] };

export interface AgentProfile {
  id: string;
  name: string;
  description: string;
  adapter: string;
  cli?: string;
  command?: string;
  voice: string;
  capabilities: string[];
  instructions: string;
}

export interface AgentRun {
  id: string;
  conversation_id: string | null;
  agent_id: string;
  adapter: string;
  parent_run_id: string | null;
  mode: 'solo' | 'delegate' | 'panel' | 'debate';
  status: 'running' | 'completed' | 'failed';
  objective: string;
  result: string;
  started_at: string;
  completed_at: string | null;
}

export interface McpTool {
  name: string;
  description: string;
  parameters?: string;
}

export interface McpServer {
  id: string;
  name: string;
  type: string;
  endpoint: string;
  status: 'connected' | 'disconnected' | 'error';
  latencyMs: number;
  tools: McpTool[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SkillModule {
  id: string;
  name: string;
  slashCommand: string;
  description: string;
  code: string;
  enabled: boolean;
  type: 'built-in' | 'custom';
  author: string;
  version: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface HardwareProfile {
  cpuCores: number;
  ramGB: number;
  freeRamGB: number;
  gpuName: string;
  os: string;
  webGLTier: string;
  recommendedLocalModel: string;
  isLocalServerDetected: boolean;
  localServerUrl: string;
  localTokensPerSec: number;
}

export interface ModelConfig {
  mode: 'auto' | 'local_only' | 'cloud_only';
  localEndpoint: string;
  selectedLocalModel: string;
  autoEscalateRules: {
    maxCharCount: number;
    requireSearch: boolean;
    requireCodeExecution: boolean;
  };
}

export interface WorkspaceEdit {
  id: string;
  file_path: string;
  content: string;
  reason: string;
  status: 'pending_review' | 'approved_and_applied' | 'rejected';
  created_at: string;
  reviewed_at?: string | null;
}

export interface VoiceRuntimeStatus {
  state: string;
  enabled: boolean;
  mode: string;
  voice: string;
  voices: string[];
  models?: any[];
  message?: string;
  detail?: string | null;
}

export interface MemoryItem {
  id: string;
  category: 'user_preference' | 'system_fact' | 'conversation_summary' | 'code_context';
  key: string;
  value: string;
  importance: 'high' | 'medium' | 'low';
  created_at?: string;
  updated_at?: string;
}





