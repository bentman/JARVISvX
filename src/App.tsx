import { Activity, Bot, ChevronRight, CircleStop, Cloud, Cpu, FileText, FolderPlus, MessageSquarePlus, Send, Settings2, X } from 'lucide-react';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { VoiceControls } from './VoiceControls';
import { VoiceHost } from './voice/VoiceHost';
import type { Conversation, Diagnostics, Provider, Root } from './types';

const fmt = (bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;

export default function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState('llamacpp');
  const [selectedModel, setSelectedModel] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [cloudApproved, setCloudApproved] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootInput, setRootInput] = useState('');
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<'diagnostics' | 'settings' | null>(null);

  const refresh = useCallback(async () => {
    try { const [providerData, history, rootData] = await Promise.all([api.providers(), api.conversations(), api.roots()]); setProviders(providerData.providers); setActiveProvider(providerData.settings.activeProvider); if (providerData.settings.activeModel) setSelectedModel(providerData.settings.activeModel); setConversations(history); setRoots(rootData); }
    catch (err: any) { setError(err.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of api.events(controller.signal)) {
          if (!['session', 'turn-complete', 'cancelled', 'error'].includes(event.type)) continue;
          await refresh();
          if (event.conversationId && event.conversationId === current?.id) await selectConversation(event.conversationId);
        }
      } catch (err: any) { if (!controller.signal.aborted) setError(`Assistant event stream: ${err.message}`); }
    })();
    return () => controller.abort();
  }, [current?.id, refresh]);
  const activeProviderInfo = providers.find((provider) => provider.id === activeProvider);
  const availableModels = activeProviderInfo?.models || [];
  useEffect(() => { if (!availableModels.includes(selectedModel)) { const next = availableModels[0] || ''; setSelectedModel(next); if (next) void api.setModel(activeProvider, next).catch((err) => setError(err.message)); } }, [activeProvider, availableModels.join('|'), selectedModel]);

  const selectConversation = async (id: string) => { try { setCurrent(await api.conversation(id)); } catch (err: any) { setError(err.message); } };
  const newConversation = async () => { const item = await api.createConversation(); setCurrent({ ...item, messages: [] }); setConversations((items) => [item, ...items]); };
  const send = async (event?: FormEvent, dictated?: string, origin: 'desktop-text' | 'voice' = 'desktop-text', targetConversationId?: string) => {
    event?.preventDefault(); const content = (dictated || input).trim(); if (!content || streaming) return;
    if (!selectedModel) { setError(`Select a model for ${activeProviderInfo?.label || 'the active provider'} before sending.`); return; }
    if (activeProvider === 'cloud' && !cloudApproved) { setError('Confirm cloud approval before sending this message.'); return; }
    setError(''); setInput(''); setStreaming(true); let conversationId = targetConversationId || current?.id;
    const optimistic = { id: 'pending-user', role: 'user' as const, content, status: 'complete', created_at: new Date().toISOString() };
    setCurrent((value) => value ? { ...value, messages: [...(value.messages || []), optimistic, { id: 'pending-ai', role: 'assistant', content: '', status: 'streaming', created_at: new Date().toISOString() }] } : { id: 'pending', title: content.slice(0, 60), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [optimistic, { id: 'pending-ai', role: 'assistant', content: '', status: 'streaming', created_at: new Date().toISOString() }] });
    try { await api.streamChat({ conversationId, content, providerId: activeProvider, model: selectedModel, allowCloud: cloudApproved, origin }, (message) => { if (message.type === 'start') conversationId = message.conversationId; if (message.type === 'token') { setCurrent((value) => value ? { ...value, id: conversationId || value.id, messages: value.messages?.map((item, index, all) => index === all.length - 1 ? { ...item, content: item.content + message.value } : item) } : value); } if (message.type === 'error') setError(message.message); }); if (conversationId) await selectConversation(conversationId); await refresh(); }
    catch (err: any) { setError(err.message); } finally { setStreaming(false); }
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key !== 'Enter' || event.altKey) return; event.preventDefault(); void send(); };
  const cancel = async () => { window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'interrupt' } })); if (current?.id && current.id !== 'pending') await api.cancel(current.id); };
  const chooseProvider = async (id: string) => { setActiveProvider(id); setSelectedModel(''); setError(''); try { await api.setProvider(id); await refresh(); } catch (err: any) { setError(err.message); } };
  const chooseModel = async (model: string) => { setSelectedModel(model); try { await api.setModel(activeProvider, model); } catch (err: any) { setError(err.message); } };
  const loadDiagnostics = async () => { setPanel('diagnostics'); try { setDiagnostics(await api.diagnostics()); } catch (err: any) { setError(err.message); } };

  return <div className="app-shell"><VoiceHost onTranscript={(value) => { void (async () => { const voice = await api.voice(); const conversationId = voice.activeSession?.conversationId || undefined; await api.voiceTranscript('final', value, conversationId); await send(undefined, value, 'voice', conversationId); })(); }} onState={(state, detail) => { void api.setVoiceState(state, detail); }} onInterrupt={() => { void cancel(); }} /><aside><div className="brand"><Bot /> <span>JARVIS<span>vX</span></span></div><button className="new" onClick={newConversation}><MessageSquarePlus /> New conversation</button><nav>{conversations.map((item) => <button className={current?.id === item.id ? 'selected' : ''} key={item.id} onClick={() => selectConversation(item.id)}>{item.title}<ChevronRight /></button>)}</nav><div className="aside-footer"><button onClick={loadDiagnostics}><Activity /> Diagnostics</button><button onClick={() => setPanel('settings')}><Settings2 /> Workspace & settings</button><a href="https://llama.app" target="_blank" rel="noreferrer">llama.app <ChevronRight /></a></div></aside><main><header><div><p className="eyebrow">LOCAL-FIRST ASSISTANT</p><h1>At your service.</h1></div><div className="model-controls"><label className="provider-picker">Provider<select value={activeProvider} onChange={(e) => chooseProvider(e.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available && provider.id !== 'cloud'}>{provider.label} {provider.available ? 'online' : provider.id === 'cloud' ? 'not configured' : 'unavailable'}</option>)}</select></label><label className="provider-picker">Model<select value={selectedModel} onChange={(e) => void chooseModel(e.target.value)} disabled={!availableModels.length}>{availableModels.length ? availableModels.map((model) => <option key={model} value={model}>{model}</option>) : <option value="">No model available</option>}</select></label></div></header>{error && <div className="alert"><span>{error}</span><button onClick={() => setError('')}><X /></button></div>}<VoiceControls /><section className="messages">{!current?.messages?.length && <div className="empty"><Cpu /><h2>Voice is the primary presence.</h2><p>Text is a secondary doorway into the same local assistant session.</p></div>}{current?.messages?.map((message) => <article className={`message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? 'YOU' : 'JARVIS'}</strong><p>{message.content || (message.status === 'streaming' ? 'Thinking…' : '')}</p></article>)}</section>{activeProvider === 'cloud' && <label className="approval"><input type="checkbox" checked={cloudApproved} onChange={(e) => setCloudApproved(e.target.checked)} /><Cloud /> I approve sending this single request to my configured cloud provider.</label>}<form className="composer" onSubmit={(event) => send(event)}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={selectedModel ? `Ask ${selectedModel} anything…` : 'Choose a provider model to begin.'} rows={2} /><button type="button" disabled={!streaming} onClick={cancel} title="Cancel request"><CircleStop /></button><button type="submit" disabled={streaming || !input.trim() || !selectedModel}><Send /> Send</button></form><p className="composer-help"><kbd>Enter</kbd> Send <span>·</span> <kbd>Alt</kbd> + <kbd>Enter</kbd> New line</p></main>{panel && <section className="side-panel"><button className="close" onClick={() => setPanel(null)}><X /></button>{panel === 'diagnostics' ? <DiagnosticsPanel data={diagnostics} refresh={loadDiagnostics} /> : <SettingsPanel roots={roots} rootInput={rootInput} setRootInput={setRootInput} setRoots={setRoots} />}</section>}</div>;
}
function DiagnosticsPanel({ data, refresh }: { data: Diagnostics | null; refresh: () => void }) { return <><h2><Activity /> Diagnostics</h2><button className="small" onClick={refresh}>Refresh</button>{!data ? <p>Loading real local diagnostics…</p> : <div className="diagnostics"><h3>System</h3><p>{data.system.platform} · {data.system.arch} · {data.system.cpu.length} CPU threads</p><p>Memory: {fmt(data.system.memory.free)} free / {fmt(data.system.memory.total)}</p><h3>Acceleration</h3>{data.acceleration.status === 'available' ? data.acceleration.gpus?.map((gpu) => <p key={gpu.name}>{gpu.name} · {gpu.memoryBytes ? fmt(gpu.memoryBytes) : 'Dedicated VRAM unavailable'}{gpu.memorySource === 'nvidia-smi' && <small> NVIDIA driver reported</small>}</p>) : <p className="muted">{data.acceleration.reason}</p>}<h3>Providers</h3>{data.providers.map((provider) => <div className="status" key={provider.id}><span className={provider.available ? 'online-dot' : 'offline-dot'} /> <b>{provider.label}</b><small>{provider.available ? provider.models.join(', ') || 'No models reported' : provider.reason}</small></div>)}</div>}</>; }
function SettingsPanel({ roots, rootInput, setRootInput, setRoots }: { roots: Root[]; rootInput: string; setRootInput: (value: string) => void; setRoots: (value: Root[]) => void }) { const add = async (event: FormEvent) => { event.preventDefault(); const root = await api.addRoot(rootInput); setRoots([...roots, root]); setRootInput(''); }; const remove = async (id: string) => { await api.removeRoot(id); setRoots(roots.filter((root) => root.id !== id)); }; return <><h2><Settings2 /> Workspace access</h2><p className="muted">JARVIS can only read UTF-8 text files inside roots you explicitly approve. Writes are not implemented.</p><form className="root-form" onSubmit={add}><input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Absolute folder path" /><button><FolderPlus /> Add root</button></form><div className="roots">{roots.map((root) => <div key={root.id}><FileText /><span>{root.path}</span><button onClick={() => remove(root.id)}><X /></button></div>)}{!roots.length && <p className="muted">No workspace roots are approved.</p>}</div><h3>Future-safe boundary</h3><p className="muted">Skills may propose edits for review, but cannot execute or write files in this release.</p></>; }
