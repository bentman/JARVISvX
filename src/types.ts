export type ProviderProtocol = 'openai-compat' | 'ollama' | 'anthropic' | 'gemini' | 'azure-openai';
export type ProviderTag = 'local' | 'cloud' | 'fast' | 'reasoning' | 'vision' | 'coding';

// Provider tags, rather than opaque IDs, determine local and cloud behavior.
export type Provider = { id: string; label: string; available: boolean; models: string[]; reason?: string; tags?: ProviderTag[]; priority?: number; protocol?: ProviderProtocol | null };

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

// Effective settings combine provider priority, model choice, and routing policy.
export interface EffectiveSettings {
  // The provider an unpinned turn routes to right now, or null when none is eligible.
  activeProvider: string | null;
  activeModel: string | null;
  activeProviderLabel: string | null;
  isCloudProvider: boolean;
  effectiveSource: string | null;
  unavailableReason: string | null;
  models: Record<string, string | null>;
  cloudConfigured: boolean;
  mode: 'auto' | 'local_only' | 'cloud_only' | string;
  autoEscalateRules: { maxCharCount: number; requireSearch: boolean; requireCodeExecution: boolean };
}

// A turn reports the provider it actually used and why routing chose it.
export interface TurnRouting {
  source: string;
  reason: string;
}

export interface ProviderTestResult {
  id: string;
  label: string;
  available: boolean;
  models: string[];
  latencyMs?: number;
  reason?: string;
}

// Reasoning and tool activity are client-only streaming state and are not persisted.
export type ToolCallActivity = { name: string; arguments?: Record<string, unknown>; output?: string; status: 'running' | 'complete' };
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; reasoning?: string; toolCalls?: ToolCallActivity[]; provider?: string; status: string; created_at: string };
export type Conversation = { id: string; title: string; created_at: string; updated_at: string; messages?: Message[] };
export type Root = { id: string; path: string; added_at: string };
export type Diagnostics = { generatedAt: string; system: { platform: string; arch: string; release: string; cpu: { model: string; speed: number }[]; cpuShortName: string; memory: { total: number; free: number }; hostClass: string }; acceleration: { status: string; reason?: string; gpus?: { name: string; memoryBytes: number | null; memorySource: string; memoryReason?: string }[]; npu?: { status: string; name?: string; reason?: string } }; providers: Provider[] };

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
  // Built-in role identity is fixed; runtime wiring remains editable.
  isBuiltIn?: boolean;
  // A shell-out profile is usable only where its CLI exists for the running session.
  available?: boolean;
  unavailableReason?: string | null;
}

// Editor options are the backend's accepted selector values and length limits.
export interface AgentEditorOptions {
  adapters: string[];
  clis: string[];
  capabilities: string[];
  maxNameLength: number;
  maxInstructionsLength: number;
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

export interface SkillExport {
  filename: string;
  content: string;
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
  // Also accepts 'provider:<id>' — pins routing to one specific provider
  // (see routeTurn() in lib/orchestrator.mjs), used when a policy mode has
  // more than one matching provider and the user picks a specific one.
  mode: 'auto' | 'local_only' | 'cloud_only' | string;
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
  // These fields require a full status fetch because voice-state events omit them.
  tuning?: any;
  activeSession?: any;
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




