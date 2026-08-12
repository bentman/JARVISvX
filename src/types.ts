export type Provider = { id: string; label: string; available: boolean; models: string[]; reason?: string };
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; provider?: string; status: string; created_at: string };
export type Conversation = { id: string; title: string; created_at: string; updated_at: string; messages?: Message[] };
export type Root = { id: string; path: string; added_at: string };
export type Diagnostics = { generatedAt: string; system: { platform: string; arch: string; release: string; cpu: { model: string; speed: number }[]; memory: { total: number; free: number } }; acceleration: { status: string; reason?: string; gpus?: { name: string; memoryBytes: number | null; memorySource: string; memoryReason?: string }[]; npu?: { status: string; name?: string; reason?: string } }; providers: Provider[] };

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




