export type ViewMode = 'voice_hud' | 'chat' | 'orchestration' | 'memory' | 'mcp_skills' | 'terminal' | 'self_evolution';

export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted';

export type PersonaId = 'jarvis' | 'friday' | 'hal9000' | 'custom';

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  tagline: string;
  voiceName: string; // WebSpeech voice or Gemini TTS voice
  systemPrompt: string;
  accentColor: string; // Hex or tailwind class
  avatarSymbol: string;
  greeting: string;
}

export interface ExecutionStep {
  tool: string;
  input: string;
  output: string;
  durationMs: number;
  status: 'success' | 'error' | 'running';
}

export interface Message {
  id: string;
  sender: 'user' | 'jarvis' | 'system';
  text: string;
  timestamp: string;
  modelUsed?: string;
  isCloudEscalated?: boolean;
  executionSteps?: ExecutionStep[];
  audioUrl?: string;
}

export interface HardwareProfile {
  cpuCores: number;
  ramGB: number;
  gpuName: string;
  os: string;
  batteryLevel?: number;
  webGLTier: string;
  recommendedLocalModel: string;
  isLocalServerDetected: boolean;
  localServerUrl: string;
  localTokensPerSec: number;
}

export interface ModelConfig {
  mode: 'auto' | 'local_only' | 'cloud_only';
  localEndpoint: string;
  localModelName: string;
  cloudModelName: string;
  temperature: number;
  topP: number;
  autoEscalateRules: {
    maxCharCount: number;
    requireSearch: boolean;
    requireCodeExecution: boolean;
  };
}

export interface MemoryItem {
  id: string;
  key: string;
  value: string;
  category: 'user_pref' | 'fact' | 'task' | 'system' | 'context';
  updatedAt: string;
  source: string;
}

export interface StorageConfig {
  provider: 'local_storage' | 'network_share' | 'aws_s3' | 'webdav' | 'cloud_sync';
  endpoint: string;
  bucketOrFolder: string;
  autoSync: boolean;
  lastSyncedAt?: string;
}

export interface McpTool {
  name: string;
  description: string;
  parameters: string;
}

export interface McpServer {
  id: string;
  name: string;
  endpoint: string;
  status: 'connected' | 'disconnected' | 'error';
  latencyMs: number;
  tools: McpTool[];
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
}
