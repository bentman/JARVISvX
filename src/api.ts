import type { Conversation, Diagnostics, Provider, Root } from './types';

declare global {
  interface Window {
    jarvisDesktop?: {
      daemon: () => Promise<{ port: number; token: string }>;
      voice: (action: string, payload?: unknown) => Promise<unknown>;
      tts: (action: string, payload?: unknown) => Promise<{ samples: Float32Array; sampleRate: number }>;
    };
  }
}

let daemon: { port: number; token: string } | null = null;

const setupDaemon = async () => {
  if (!daemon && window.jarvisDesktop) daemon = await window.jarvisDesktop.daemon();
  return daemon;
};

const json = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const config = await setupDaemon();
  const response = await fetch(`${config ? `http://127.0.0.1:${config.port}` : ''}${url}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(config ? { 'x-jarvis-token': config.token } : {}), ...options?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json();
};

export const api = {
  providers: () => json<{ settings: { activeProvider: string; activeModel: string | null; cloudConfigured: boolean }; providers: Provider[] }>('/api/providers'),
  diagnostics: () => json<Diagnostics>('/api/diagnostics'),
  voice: () => json<any>('/api/voice'),
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
  roots: () => json<Root[]>('/api/workspace-roots'),
  addRoot: (path: string) => json<Root>('/api/workspace-roots', { method: 'POST', body: JSON.stringify({ path }) }),
  removeRoot: (id: string) => json<{ removed: boolean }>(`/api/workspace-roots/${id}`, { method: 'DELETE' }),
  setProvider: (provider: string) => json<void>('/api/settings/active-provider', { method: 'POST', body: JSON.stringify({ provider }) }),
  setModel: (provider: string, model: string) => json<void>('/api/settings/model', { method: 'POST', body: JSON.stringify({ provider, model }) }),
  cancel: (id: string) => json<{ cancelled: boolean }>(`/api/chat/${id}/cancel`, { method: 'POST', body: '{}' }),
  async *events(signal?: AbortSignal) {
    const config = await setupDaemon();
    const response = await fetch(`${config ? `http://127.0.0.1:${config.port}` : ''}/api/events`, { headers: config ? { 'x-jarvis-token': config.token } : {}, signal });
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
    const response = await fetch(`${config ? `http://127.0.0.1:${config.port}` : ''}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(config ? { 'x-jarvis-token': config.token } : {}) }, body: JSON.stringify(payload) });
    if (!response.ok || !response.body) throw new Error('Unable to open response stream.');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const chunks = buffer.split('\n\n'); buffer = chunks.pop() || '';
      for (const chunk of chunks) { const row = chunk.split('\n').find((line) => line.startsWith('data:')); if (row) onEvent(JSON.parse(row.slice(5))); }
    }
  }
};
