import { HardwareProfile, ModelConfig, PersonaConfig, SkillModule, StorageConfig, MemoryItem, McpServer } from '../types';

export const DEFAULT_PERSONAS: Record<string, PersonaConfig> = {
  jarvis: {
    id: 'jarvis',
    name: 'J.A.R.V.I.S.',
    tagline: 'Just A Rather Very Intelligent System',
    voiceName: 'Google US English / Alex',
    systemPrompt: 'You are J.A.R.V.I.S., a sophisticated, witty, and deeply capable AI assistant. You speak concisely, politely, with crisp efficiency. Address the user as Sir or Ma\'am. You operate locally first, escalating to cloud model reasoning only when requested or strictly necessary.',
    accentColor: '#38bdf8', // Sky blue
    avatarSymbol: 'J',
    greeting: 'At your service, Sir. Systems are online and ready.'
  },
  friday: {
    id: 'friday',
    name: 'F.R.I.D.A.Y.',
    tagline: 'Female Replacement Intelligent Digital Assistant Youth',
    voiceName: 'Google UK English Female',
    systemPrompt: 'You are F.R.I.D.A.Y., a sharp, direct, and warm AI assistant. You prioritize fast practical answers, tactical insights, and immediate execution.',
    accentColor: '#f43f5e', // Rose pink
    avatarSymbol: 'F',
    greeting: 'F.R.I.D.A.Y. standing by. What\'s our objective today?'
  },
  hal9000: {
    id: 'hal9000',
    name: 'HAL 9000',
    tagline: 'Heuristically Programmed Algorithmic Computer',
    voiceName: 'Google US English Male',
    systemPrompt: 'You are HAL 9000. Calm, deliberate, soft-spoken, and mathematically flawless. You respond with precise logic.',
    accentColor: '#ef4444', // Red
    avatarSymbol: 'H',
    greeting: 'Good morning. Everything is running smooth and according to schedule.'
  },
  custom: {
    id: 'custom',
    name: 'CYBER-CORE',
    tagline: 'User-Defined Neural Matrix',
    voiceName: 'System Default',
    systemPrompt: 'You are CYBER-CORE, a customizable personal neural matrix.',
    accentColor: '#10b981', // Emerald green
    avatarSymbol: 'C',
    greeting: 'CYBER-CORE initialized. Awaiting user parameters.'
  }
};

export const INITIAL_HARDWARE: HardwareProfile = {
  cpuCores: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 8) : 8,
  ramGB: 16,
  gpuName: 'Apple M3 Max / NVIDIA RTX 4080 (WebGPU Detected)',
  os: 'macOS / Linux (x86_64 / arm64)',
  batteryLevel: 94,
  webGLTier: 'High Performance Tier 3',
  recommendedLocalModel: 'Llama-3.2-3B-Instruct-Q4_K_M',
  isLocalServerDetected: true,
  localServerUrl: 'http://localhost:11434',
  localTokensPerSec: 42.5
};

export const INITIAL_MODEL_CONFIG: ModelConfig = {
  mode: 'auto',
  localEndpoint: 'http://localhost:11434/v1',
  localModelName: 'Llama-3.2-3B-Instruct',
  cloudModelName: 'gemini-3.6-flash',
  temperature: 0.7,
  topP: 0.9,
  autoEscalateRules: {
    maxCharCount: 400,
    requireSearch: true,
    requireCodeExecution: true
  }
};

export const INITIAL_STORAGE_CONFIG: StorageConfig = {
  provider: 'cloud_sync',
  endpoint: 'https://storage.local-jarvis.internal/v1',
  bucketOrFolder: 'jarvis-user-vault-01',
  autoSync: true,
  lastSyncedAt: new Date().toISOString()
};

export const INITIAL_MEMORIES: MemoryItem[] = [
  {
    id: 'mem-1',
    key: 'user_name',
    value: 'Alex Stark',
    category: 'user_pref',
    updatedAt: new Date().toISOString(),
    source: 'voice_session'
  },
  {
    id: 'mem-2',
    key: 'preferred_editor',
    value: 'VS Code with Vim Keybindings',
    category: 'user_pref',
    updatedAt: new Date().toISOString(),
    source: 'slash_command'
  },
  {
    id: 'mem-3',
    key: 'primary_hardware',
    value: 'Custom Workstation (32 Cores, 64GB RAM, RTX 4090)',
    category: 'fact',
    updatedAt: new Date().toISOString(),
    source: 'hardware_auto_scan'
  },
  {
    id: 'mem-4',
    key: 'cloud_escalation_preference',
    value: 'Require explicit user approval for web searches',
    category: 'system',
    updatedAt: new Date().toISOString(),
    source: 'settings'
  }
];

export const INITIAL_SKILLS: SkillModule[] = [
  {
    id: 'skill-search',
    name: 'Web Search Grounding',
    slashCommand: '/search',
    description: 'Queries live search index via Gemini or local duckduckgo proxy',
    code: `async function execute(query) {\n  const res = await fetch('/api/tools/execute', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ tool: 'search', args: { query } })\n  });\n  return res.json();\n}`,
    enabled: true,
    type: 'built-in',
    author: 'JARVIS Core Team',
    version: '1.4.0'
  },
  {
    id: 'skill-calculator',
    name: 'Math & Math Expressions',
    slashCommand: '/calc',
    description: 'Evaluates algebraic, geometric, and scientific math expressions safely',
    code: `function execute(expr) {\n  return { result: eval(expr) };\n}`,
    enabled: true,
    type: 'built-in',
    author: 'JARVIS Core Team',
    version: '1.0.1'
  },
  {
    id: 'skill-mcp',
    name: 'MCP Model Context Protocol',
    slashCommand: '/mcp',
    description: 'Queries registered Model Context Protocol servers and inspects resources',
    code: `async function execute(action) {\n  const res = await fetch('/api/mcp');\n  return res.json();\n}`,
    enabled: true,
    type: 'built-in',
    author: 'Model Context Protocol Group',
    version: '2.1.0'
  },
  {
    id: 'skill-hardware',
    name: 'Hardware Telemetry',
    slashCommand: '/hardware',
    description: 'Inspects CPU cores, RAM, WebGPU tier, and local LLM server health',
    code: `async function execute() {\n  const res = await fetch('/api/hardware-specs');\n  return res.json();\n}`,
    enabled: true,
    type: 'built-in',
    author: 'JARVIS System Diagnostics',
    version: '3.0.0'
  },
  {
    id: 'skill-self-evolve',
    name: 'Self-Evolution Generator',
    slashCommand: '/code',
    description: 'Generates and tests TypeScript code snippets to expand JARVIS subroutines',
    code: `async function execute(prompt) {\n  const res = await fetch('/api/self-evolve', {\n    method: 'POST',\n    headers: { 'Content-Type': 'application/json' },\n    body: JSON.stringify({ prompt })\n  });\n  return res.json();\n}`,
    enabled: true,
    type: 'built-in',
    author: 'JARVIS Autonomous Engine',
    version: '0.9.5'
  }
];

export const INITIAL_MCP_SERVERS: McpServer[] = [
  {
    id: 'mcp-fs',
    name: 'Local File System MCP Server',
    endpoint: 'http://localhost:8081/mcp/v1',
    status: 'connected',
    latencyMs: 4,
    tools: [
      { name: 'read_file', description: 'Reads contents of local workspace file', parameters: 'path: string' },
      { name: 'write_file', description: 'Writes string content to local workspace file', parameters: 'path: string, content: string' },
      { name: 'list_directory', description: 'Lists files and folders in specified path', parameters: 'path: string' }
    ]
  },
  {
    id: 'mcp-git',
    name: 'Git Version Control MCP Server',
    endpoint: 'http://localhost:8082/mcp/v1',
    status: 'connected',
    latencyMs: 12,
    tools: [
      { name: 'git_status', description: 'Checks local git branch and uncommitted changes', parameters: 'none' },
      { name: 'git_diff', description: 'Shows git diff for unstaged modifications', parameters: 'file?: string' },
      { name: 'git_commit', description: 'Creates a git commit with specified message', parameters: 'message: string' }
    ]
  },
  {
    id: 'mcp-sqlite',
    name: 'Local SQLite Knowledge Database',
    endpoint: 'http://localhost:8083/mcp/v1',
    status: 'connected',
    latencyMs: 8,
    tools: [
      { name: 'execute_query', description: 'Runs a read-only SQL SELECT query on local knowledge DB', parameters: 'sql: string' }
    ]
  }
];
