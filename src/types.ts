export type Provider = { id: string; label: string; available: boolean; models: string[]; reason?: string };
export type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string; provider?: string; status: string; created_at: string };
export type Conversation = { id: string; title: string; created_at: string; updated_at: string; messages?: Message[] };
export type Root = { id: string; path: string; added_at: string };
export type Diagnostics = { generatedAt: string; system: { platform: string; arch: string; release: string; cpu: { model: string; speed: number }[]; memory: { total: number; free: number } }; acceleration: { status: string; reason?: string; gpus?: { name: string; memoryBytes: number | null; memorySource: string; memoryReason?: string }[]; npu?: { status: string; reason: string } }; providers: Provider[] };
