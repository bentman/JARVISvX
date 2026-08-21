import { Activity, Bot, Brain, ChevronRight, CircleStop, Cloud, Cpu, Database, FolderPlus, MessageSquarePlus, Mic, Send, Settings2, Trash2, Users, X, Zap } from 'lucide-react';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { VoiceHost } from './voice/VoiceHost';
import { McpSkillsView } from './components/McpSkillsView';
import { ModelOrchestrationView } from './components/ModelOrchestrationView';
import { VoiceHudView } from './components/VoiceHudView';
import { MemoryCenterView } from './components/MemoryCenterView';
import { AgentOrchestrationView } from './components/AgentOrchestrationView';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { WorkspacesPanel } from './components/WorkspacesPanel';
import { ProvidersView } from './components/ProvidersView';
import { Thinking } from './components/Thinking';
import { ToolActivity } from './components/ToolActivity';
import type { Conversation, Diagnostics, Provider, Root } from './types';

const cleanVoiceTranscript = (text: string) => { const cleaned = String(text || '').replace(/^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise|wooshing(?: sound)?|water splashing|splashing|wind|breathing)[\])]?\.?)*\s*$/i, '').replace(/^\s*(?:hey\s+)?jarvis\b[\s,.:;-]*/i, '').trim(); return cleaned && !/^\s*[\[(]?[a-z\s-]+(?:sound|noise|music|breathing|wind|splashing)[\])]?\.?\s*$/i.test(cleaned) ? cleaned : null; };
const mergeUnique = (items: string[]) => Array.from(new Set(items.filter(Boolean)));

export default function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProvider, setActiveProvider] = useState('llamacpp');
  const [selectedModel, setSelectedModel] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [current, setCurrent] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [cloudApproved, setCloudApproved] = useState(false);
  const [allowToolWrites, setAllowToolWrites] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [roots, setRoots] = useState<Root[]>([]);
  const [rootInput, setRootInput] = useState('');
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<'voice_hud' | 'agents' | 'providers' | 'mcp_skills' | 'orchestration' | 'memory' | 'workspaces' | 'diagnostics' | 'settings' | null>(null);
  const activeTurnRef = useRef<{ conversationId: string; turnId: string; assistantMessageId: string } | null>(null);

  const refresh = useCallback(async () => {
    try { const [providerData, history, rootData] = await Promise.all([api.providerHealth(), api.conversations(), api.roots()]); const nextActiveProvider = providerData.settings.activeProvider; let nextProviders = providerData.providers; try { const modelData = await api.models(nextActiveProvider); if (modelData.models.length) nextProviders = nextProviders.map((provider) => provider.id === nextActiveProvider ? { ...provider, models: mergeUnique([...(provider.models || []), ...modelData.models]), available: true } : provider); } catch {} setProviders(nextProviders); setActiveProvider(nextActiveProvider); const nextActiveModels = nextProviders.find((provider) => provider.id === nextActiveProvider)?.models || []; if (providerData.settings.activeModel) setSelectedModel(providerData.settings.activeModel); else if (nextActiveModels[0]) setSelectedModel(nextActiveModels[0]); setConversations(history); setRoots(rootData); }
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
  // Cloud approval follows the provider tag because provider IDs are opaque.
  const isCloudProvider = Boolean(activeProviderInfo?.tags?.includes('cloud'));
  useEffect(() => { if (!availableModels.includes(selectedModel)) { const next = availableModels[0] || ''; setSelectedModel(next); if (next) void api.setModel(activeProvider, next).catch((err) => setError(err.message)); } }, [activeProvider, availableModels.join('|'), selectedModel]);

  const selectConversation = async (id: string) => { try { setCurrent(await api.conversation(id)); } catch (err: any) { setError(err.message); } };
  const newConversation = async () => { const item = await api.createConversation(); setCurrent({ ...item, messages: [] }); setConversations((items) => [item, ...items]); };
  const deleteConversation = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await api.deleteConversation(id);
      if (current?.id === id) setCurrent(null);
      await refresh();
    } catch (err: any) { setError(err.message); }
  };
  const send = async (event?: FormEvent, dictated?: string, origin: 'desktop-text' | 'voice' = 'desktop-text', targetConversationId?: string | null) => {
    event?.preventDefault();
    const content = (dictated || input).trim();
    if (!content || streaming) return;
    if (!selectedModel && !content.startsWith('/')) { setError(`Select a model for ${activeProviderInfo?.label || 'the active provider'} before sending.`); return; }
    if (isCloudProvider && !cloudApproved && !content.startsWith('/')) { setError('Confirm cloud approval before sending this message.'); return; }
    setError('');
    setInput('');
    setStreaming(true);
    let conversationId = targetConversationId === undefined ? current?.id : targetConversationId || undefined;
    let turnId: string | undefined;
    const userMessageId = `pending-user-${crypto.randomUUID()}`;
    const assistantMessageId = `pending-ai-${crypto.randomUUID()}`;
    const optimistic = { id: userMessageId, role: 'user' as const, content, status: 'complete', created_at: new Date().toISOString() };
    const optimisticAssistant = { id: assistantMessageId, role: 'assistant' as const, content: '', reasoning: '', toolCalls: [], status: 'streaming', created_at: new Date().toISOString() };
    const shouldAppendToCurrent = Boolean(conversationId);
    setCurrent((value) => shouldAppendToCurrent && value ? { ...value, messages: [...(value.messages || []), optimistic, optimisticAssistant] } : { id: 'pending', title: content.slice(0, 60), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [optimistic, optimisticAssistant] });
    try {
      await api.streamChat({ conversationId, content, providerId: activeProvider, model: selectedModel, allowCloud: cloudApproved, allowToolWrites, origin }, (message) => {
        if (message.type === 'start') {
          conversationId = message.conversationId;
          turnId = message.turnId;
          activeTurnRef.current = conversationId && turnId ? { conversationId, turnId, assistantMessageId } : null;
          setCurrent((value) => value && value.id === 'pending' ? { ...value, id: conversationId || value.id } : value);
        }
        const ownsTurn = Boolean(conversationId && turnId && message.conversationId === conversationId && message.turnId === turnId);
        if (origin === 'voice' && message.type === 'token' && ownsTurn) window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'assistant-token', value: message.value, conversationId, turnId } }));
        if (origin === 'voice' && message.type === 'turn-complete' && ownsTurn) window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'assistant-complete', conversationId, turnId } }));
        if (origin === 'voice' && (message.type === 'cancelled' || message.type === 'error') && ownsTurn) window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'assistant-error', conversationId, turnId } }));
        if (message.type === 'token' && ownsTurn) {
          setCurrent((value) => value && value.id === conversationId ? { ...value, messages: value.messages?.map((item) => item.id === assistantMessageId ? { ...item, content: item.content + message.value } : item) } : value);
        }
        // Reasoning and tool activity are request-local and are not persisted.
        if (message.type === 'reasoning' && ownsTurn) {
          setCurrent((value) => value && value.id === conversationId ? { ...value, messages: value.messages?.map((item) => item.id === assistantMessageId ? { ...item, reasoning: (item.reasoning || '') + message.value } : item) } : value);
        }
        if (message.type === 'tool-call' && ownsTurn) {
          setCurrent((value) => value && value.id === conversationId ? { ...value, messages: value.messages?.map((item) => item.id === assistantMessageId ? { ...item, toolCalls: [...(item.toolCalls || []), { name: message.name, arguments: message.arguments, status: 'running' as const }] } : item) } : value);
        }
        if (message.type === 'tool-result' && ownsTurn) {
          setCurrent((value) => value && value.id === conversationId ? { ...value, messages: value.messages?.map((item) => {
            if (item.id !== assistantMessageId) return item;
            const calls = item.toolCalls || [];
            const index = calls.map((call) => call.status === 'running' && call.name === message.name).lastIndexOf(true);
            if (index === -1) return item;
            const nextCalls = calls.slice();
            nextCalls[index] = { ...nextCalls[index], output: message.output, status: 'complete' as const };
            return { ...item, toolCalls: nextCalls };
          }) } : value);
        }
        if (message.type === 'tool-approval-required' && (!message.turnId || ownsTurn)) setError(`JARVIS wants to run "${message.name}", which needs approval first. Check "Allow tool writes" below and send your message again.`);
        if (message.type === 'error' && (!message.turnId || ownsTurn)) setError(message.message);
      });
      if (conversationId) await selectConversation(conversationId);
      await refresh();
    }
    catch (err: any) { setError(err.message); }
    finally {
      if (activeTurnRef.current?.turnId === turnId) activeTurnRef.current = null;
      setStreaming(false);
    }
  };
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key !== 'Enter' || event.altKey) return; event.preventDefault(); void send(); };
  const cancel = async () => { const activeTurn = activeTurnRef.current; window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'interrupt', conversationId: activeTurn?.conversationId, turnId: activeTurn?.turnId } })); if (activeTurn?.conversationId) await api.cancel(activeTurn.conversationId, activeTurn.turnId); else if (current?.id && current.id !== 'pending') await api.cancel(current.id); };
  const pushToTalk = () => { window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { type: 'capture' } })); void api.setVoiceState('capturing'); };
  // Provider selection is local to the composer and is submitted with each turn.
  const chooseProvider = (id: string) => { setActiveProvider(id); setSelectedModel(''); setError(''); };
  const chooseModel = async (model: string) => { setSelectedModel(model); try { await api.setModel(activeProvider, model); } catch (err: any) { setError(err.message); } };
  const loadDiagnostics = useCallback(async () => {
    try { setDiagnostics(await api.diagnostics()); }
    catch (err: any) { setError(err.message); }
  }, []);

  useEffect(() => {
    if (panel === 'diagnostics') { void loadDiagnostics(); }
  }, [panel, loadDiagnostics]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [current?.messages]);

  return <div className="app-shell"><VoiceHost onTranscript={(value) => { void (async () => { const cleaned = cleanVoiceTranscript(value); if (!cleaned) { await api.setVoiceState('wake-listening', 'No speech was captured after the wake word.'); return; } const voice = await api.voice(); const target = voice.mode === 'wake' && current?.id !== 'pending' && (current?.messages?.length || 0) > 0 ? null : current?.id; const accepted = await api.voiceTranscript('final', cleaned, target || undefined); if (accepted.accepted) await send(undefined, cleaned, 'voice', target); else await api.setVoiceState('wake-listening', 'No usable speech was captured after the wake word.'); })(); }} onState={(state, detail) => { void api.setVoiceState(state, detail); }} onInterrupt={() => { void cancel(); }} /><aside><div className="brand"><Bot /> <span>JARVIS<span>vX</span></span></div><button className="new" onClick={newConversation}><MessageSquarePlus /> New conversation</button><nav>{conversations.map((item) => <div className={`nav-item ${current?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectConversation(item.id)}><span className="nav-title" title={item.title}>{item.title}</span><button className="nav-delete" onClick={(e) => deleteConversation(item.id, e)} title="Delete conversation"><Trash2 style={{ width: 14, height: 14 }} /></button></div>)}</nav><div className="aside-footer"><button onClick={() => setPanel('voice_hud')}><Mic /> Voice HUD</button><button onClick={() => setPanel('agents')}><Users /> Agent Runtime</button><button onClick={() => setPanel('providers')}><Database /> Providers</button><button onClick={() => setPanel('mcp_skills')}><Zap /> MCP &amp; Skills</button><button onClick={() => setPanel('orchestration')}><Cpu /> Orchestration</button><button onClick={() => setPanel('memory')}><Brain /> Memory Center</button><button onClick={() => setPanel('workspaces')}><FolderPlus /> Workspaces</button><button onClick={() => setPanel('diagnostics')}><Activity /> Diagnostics</button><button onClick={() => setPanel('settings')}><Settings2 /> Settings</button><a href="https://llama.app" target="_blank" rel="noreferrer">llama.app <ChevronRight /></a></div></aside><main><header><div><p className="eyebrow">LOCAL-FIRST ASSISTANT</p><h1>Just A Rather Very Intelligent System</h1></div><div className="model-controls"><button className="status-badge" onClick={() => setPanel('settings')} title="Click to manage Provider in Settings"><span className={activeProviderInfo?.available ? 'online-dot' : 'offline-dot'} /><span className="badge-label">Provider:</span> <strong className="badge-value">{activeProviderInfo?.label || activeProvider}</strong></button><button className="status-badge" onClick={() => setPanel('settings')} title="Click to manage Model in Settings"><span className="badge-label">Model:</span> <strong className="badge-value">{selectedModel || 'No model active'}</strong></button>{isCloudProvider && <span className={`status-badge ${cloudApproved ? 'approved' : 'pending'}`}><Cloud style={{ width: 12, height: 12 }} /> {cloudApproved ? 'Cloud Approved' : 'Approval Pending'}</span>}</div></header>{error && <div className="alert"><span>{error}</span><button onClick={() => setError('')}><X /></button></div>}<section className="messages">{!current?.messages?.length && <div className="empty"><Cpu /><h2>Voice is the primary presence.</h2><p>Text is available when speaking is not practical.</p></div>}{current?.messages?.map((message) => <article className={`message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? 'YOU' : 'JARVIS'}</strong>{message.role === 'assistant' && <Thinking text={message.reasoning || ''} streaming={message.status === 'streaming'} />}{message.role === 'assistant' && <ToolActivity calls={message.toolCalls} />}<p>{message.content || (message.status === 'streaming' && !message.reasoning ? 'Thinking…' : '')}</p></article>)}<div ref={messagesEndRef} /></section><div className="composer-container">{isCloudProvider && <label className="approval"><input type="checkbox" checked={cloudApproved} onChange={(e) => setCloudApproved(e.target.checked)} /><Cloud /> I approve sending this single request to my configured cloud provider.</label>}<label className="approval"><input type="checkbox" checked={allowToolWrites} onChange={(e) => setAllowToolWrites(e.target.checked)} /><Zap style={{ width: 14, height: 14 }} /> Allow JARVIS to run tools that write files or execute changes this turn.</label><form className="composer" onSubmit={(event) => send(event)}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={selectedModel ? `Ask ${selectedModel} anything… (or type /slash skill or @agent)` : 'Choose a provider model, /slash skill, or @agent…'} rows={2} /><button type="button" disabled={!streaming} onClick={cancel} title="Cancel request"><CircleStop /></button><button type="submit" disabled={streaming || !input.trim()}><Send /> Send</button><button type="button" disabled={streaming} onClick={pushToTalk} title="Push to talk"><Mic /></button></form><p className="composer-help"><kbd>Enter</kbd> Send <span>·</span> <kbd>Alt</kbd> + <kbd>Enter</kbd> New line</p></div></main>{panel && <section className="side-panel"><button className="close" onClick={() => setPanel(null)}><X /></button>{panel === 'voice_hud' ? <VoiceHudView /> : panel === 'agents' ? <AgentOrchestrationView /> : panel === 'providers' ? <ProvidersView onProvidersChanged={refresh} /> : panel === 'mcp_skills' ? <McpSkillsView /> : panel === 'orchestration' ? <ModelOrchestrationView onProvidersChanged={refresh} onOpenProviders={() => setPanel('providers')} /> : panel === 'memory' ? <MemoryCenterView /> : panel === 'workspaces' ? <WorkspacesPanel roots={roots} rootInput={rootInput} setRootInput={setRootInput} setRoots={setRoots} /> : panel === 'diagnostics' ? <DiagnosticsPanel data={diagnostics} refresh={loadDiagnostics} /> : <SettingsPanel providers={providers} activeProvider={activeProvider} chooseProvider={chooseProvider} availableModels={availableModels} selectedModel={selectedModel} chooseModel={chooseModel} cloudApproved={cloudApproved} setCloudApproved={setCloudApproved} />}</section>}</div>;
}

