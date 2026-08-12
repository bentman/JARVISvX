import { Activity, Bot, Brain, ChevronRight, CircleStop, Cloud, Cpu, FileText, FolderPlus, MessageSquarePlus, Mic, Send, Settings2, Trash2, X, Zap } from 'lucide-react';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { VoiceDiagnostics } from './VoiceControls';
import { VoiceHost } from './voice/VoiceHost';
import { McpSkillsView } from './components/McpSkillsView';
import { ModelOrchestrationView } from './components/ModelOrchestrationView';
import { VoiceHudView } from './components/VoiceHudView';
import { MemoryCenterView } from './components/MemoryCenterView';
import type { Conversation, Diagnostics, Provider, Root } from './types';

const fmt = (bytes: number) => `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
const cleanVoiceTranscript = (text: string) => { const cleaned = String(text || '').replace(/^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise|wooshing(?: sound)?|water splashing|splashing|wind|breathing)[\])]?\.?)*\s*$/i, '').replace(/^\s*(?:hey\s+)?jarvis\b[\s,.:;-]*/i, '').trim(); return cleaned && !/^\s*[\[(]?[a-z\s-]+(?:sound|noise|music|breathing|wind|splashing)[\])]?\.?\s*$/i.test(cleaned) ? cleaned : null; };

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
  const [panel, setPanel] = useState<'diagnostics' | 'settings' | 'mcp_skills' | 'orchestration' | 'voice_hud' | 'memory' | null>(null);
  const activeTurnRef = useRef<{ conversationId: string; turnId: string; assistantMessageId: string } | null>(null);

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
    if (activeProvider === 'cloud' && !cloudApproved && !content.startsWith('/')) { setError('Confirm cloud approval before sending this message.'); return; }
    setError('');
    setInput('');
    setStreaming(true);
    let conversationId = targetConversationId === undefined ? current?.id : targetConversationId || undefined;
    let turnId: string | undefined;
    const userMessageId = `pending-user-${crypto.randomUUID()}`;
    const assistantMessageId = `pending-ai-${crypto.randomUUID()}`;
    const optimistic = { id: userMessageId, role: 'user' as const, content, status: 'complete', created_at: new Date().toISOString() };
    const optimisticAssistant = { id: assistantMessageId, role: 'assistant' as const, content: '', status: 'streaming', created_at: new Date().toISOString() };
    const shouldAppendToCurrent = Boolean(conversationId);
    setCurrent((value) => shouldAppendToCurrent && value ? { ...value, messages: [...(value.messages || []), optimistic, optimisticAssistant] } : { id: 'pending', title: content.slice(0, 60), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), messages: [optimistic, optimisticAssistant] });
    try {
      await api.streamChat({ conversationId, content, providerId: activeProvider, model: selectedModel, allowCloud: cloudApproved, origin }, (message) => {
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
  const chooseProvider = async (id: string) => { setActiveProvider(id); setSelectedModel(''); setError(''); try { await api.setProvider(id); await refresh(); } catch (err: any) { setError(err.message); } };
  const chooseModel = async (model: string) => { setSelectedModel(model); try { await api.setModel(activeProvider, model); } catch (err: any) { setError(err.message); } };
  const loadDiagnostics = useCallback(async () => {
    try { setDiagnostics(await api.diagnostics()); }
    catch (err: any) { setError(err.message); }
  }, []);

  useEffect(() => {
    if (panel === 'diagnostics') { void loadDiagnostics(); }
  }, [panel, loadDiagnostics]);

  return <div className="app-shell"><VoiceHost onTranscript={(value) => { void (async () => { const cleaned = cleanVoiceTranscript(value); if (!cleaned) { await api.setVoiceState('wake-listening', 'No speech was captured after the wake word.'); return; } const voice = await api.voice(); const target = voice.mode === 'wake' && current?.id !== 'pending' && (current?.messages?.length || 0) > 0 ? null : current?.id; const accepted = await api.voiceTranscript('final', cleaned, target || undefined); if (accepted.accepted) await send(undefined, cleaned, 'voice', target); else await api.setVoiceState('wake-listening', 'No usable speech was captured after the wake word.'); })(); }} onState={(state, detail) => { void api.setVoiceState(state, detail); }} onInterrupt={() => { void cancel(); }} /><aside><div className="brand"><Bot /> <span>JARVIS<span>vX</span></span></div><button className="new" onClick={newConversation}><MessageSquarePlus /> New conversation</button><nav>{conversations.map((item) => <div className={`nav-item ${current?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectConversation(item.id)}><span className="nav-title" title={item.title}>{item.title}</span><button className="nav-delete" onClick={(e) => deleteConversation(item.id, e)} title="Delete conversation"><Trash2 style={{ width: 14, height: 14 }} /></button></div>)}</nav><div className="aside-footer"><button onClick={() => setPanel('memory')}><Brain /> Memory Center</button><button onClick={() => setPanel('voice_hud')}><Mic /> Voice HUD</button><button onClick={() => setPanel('orchestration')}><Cpu /> Orchestration</button><button onClick={() => setPanel('mcp_skills')}><Zap /> MCP & Skills</button><button onClick={() => setPanel('diagnostics')}><Activity /> Diagnostics</button><button onClick={() => setPanel('settings')}><Settings2 /> Workspace & settings</button><a href="https://llama.app" target="_blank" rel="noreferrer">llama.app <ChevronRight /></a></div></aside><main><header><div><p className="eyebrow">LOCAL-FIRST ASSISTANT</p><h1>Just A Rather Very Intelligent System</h1></div><div className="model-controls"><label className="provider-picker">Provider<select value={activeProvider} onChange={(e) => chooseProvider(e.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available && provider.id !== 'cloud'}>{provider.label} {provider.available ? 'online' : provider.id === 'cloud' ? 'not configured' : 'unavailable'}</option>)}</select></label><label className="provider-picker">Model<select value={selectedModel} onChange={(e) => void chooseModel(e.target.value)} disabled={!availableModels.length}>{availableModels.length ? availableModels.map((model) => <option key={model} value={model}>{model}</option>) : <option value="">No model available</option>}</select></label></div></header>{error && <div className="alert"><span>{error}</span><button onClick={() => setError('')}><X /></button></div>}<section className="messages">{!current?.messages?.length && <div className="empty"><Cpu /><h2>Voice is the primary presence.</h2><p>Text is available when speaking is not practical.</p></div>}{current?.messages?.map((message) => <article className={`message ${message.role}`} key={message.id}><strong>{message.role === 'user' ? 'YOU' : 'JARVIS'}</strong><p>{message.content || (message.status === 'streaming' ? 'Thinking…' : '')}</p></article>)}</section>{activeProvider === 'cloud' && <label className="approval"><input type="checkbox" checked={cloudApproved} onChange={(e) => setCloudApproved(e.target.checked)} /><Cloud /> I approve sending this single request to my configured cloud provider.</label>}<form className="composer" onSubmit={(event) => send(event)}><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={selectedModel ? `Ask ${selectedModel} anything… (or type /slash skill)` : 'Choose a provider model or type /slash skill…'} rows={2} /><button type="button" disabled={!streaming} onClick={cancel} title="Cancel request"><CircleStop /></button><button type="submit" disabled={streaming || !input.trim()}><Send /> Send</button><button type="button" disabled={streaming} onClick={pushToTalk} title="Push to talk"><Mic /></button></form><p className="composer-help"><kbd>Enter</kbd> Send <span>·</span> <kbd>Alt</kbd> + <kbd>Enter</kbd> New line</p></main>{panel && <section className="side-panel" style={panel === 'mcp_skills' || panel === 'orchestration' || panel === 'voice_hud' || panel === 'memory' ? { width: '85vw', maxWidth: '1200px' } : undefined}><button className="close" onClick={() => setPanel(null)}><X /></button>{panel === 'memory' ? <MemoryCenterView /> : panel === 'voice_hud' ? <VoiceHudView /> : panel === 'orchestration' ? <ModelOrchestrationView /> : panel === 'mcp_skills' ? <McpSkillsView /> : panel === 'diagnostics' ? <DiagnosticsPanel data={diagnostics} refresh={loadDiagnostics} /> : <SettingsPanel roots={roots} rootInput={rootInput} setRootInput={setRootInput} setRoots={setRoots} />}</section>}</div>;
}
function DiagnosticsPanel({ data, refresh }: { data: Diagnostics | null; refresh: () => void }) { return <><h2><Activity /> Diagnostics</h2><button className="small" onClick={refresh}>Refresh Telemetry</button>{!data ? <div className="diagnostics"><p>Fetching real local system diagnostics…</p><button className="small" onClick={refresh}>Force Retry</button></div> : <div className="diagnostics"><h3>System</h3><p>{data.system.platform} · {data.system.arch} · {data.system.cpu.length} CPU threads</p><p>Memory: {fmt(data.system.memory.free)} free / {fmt(data.system.memory.total)}</p><h3>Acceleration & Hardware Probes</h3>{data.acceleration.status === 'available' ? <> {data.acceleration.gpus?.map((gpu) => <p key={gpu.name}><b>GPU:</b> {gpu.name} · {gpu.memoryBytes ? fmt(gpu.memoryBytes) : 'Dedicated VRAM unavailable'}{gpu.memorySource === 'nvidia-smi' && <small> (NVIDIA driver reported)</small>}</p>)} {data.acceleration.npu && <p><b>NPU / Neural Engine:</b> {data.acceleration.npu.name || 'Hardware Neural Processor'} · <small>{data.acceleration.npu.status === 'available' ? 'Active' : data.acceleration.npu.reason}</small></p>} </> : <p className="muted">{data.acceleration.reason}</p>}<h3>Provider Runtimes</h3>{data.providers.map((provider) => <div className="status" key={provider.id}><span className={provider.available ? 'online-dot' : 'offline-dot'} /> <b>{provider.label}</b><small>{provider.available ? provider.models.join(', ') || 'No models reported' : provider.reason}</small></div>)}<VoiceDiagnostics /></div>}</>; }
function SettingsPanel({ roots, rootInput, setRootInput, setRoots }: { roots: Root[]; rootInput: string; setRootInput: (value: string) => void; setRoots: (value: Root[]) => void }) {
  const [edits, setEdits] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadEdits = useCallback(async () => {
    try { setEdits(await api.workspaceEdits()); } catch {}
  }, []);

  useEffect(() => { void loadEdits(); }, [loadEdits]);

  const add = async (event: FormEvent) => { event.preventDefault(); const root = await api.addRoot(rootInput); setRoots([...roots, root]); setRootInput(''); };
  const remove = async (id: string) => { await api.removeRoot(id); setRoots(roots.filter((root) => root.id !== id)); };

  const handleApprove = async (id: string) => {
    setLoading(true);
    try {
      await api.approveWorkspaceEdit(id);
      setActionSuccess('File edit approved & written to workspace!');
      setTimeout(() => setActionSuccess(null), 3000);
      await loadEdits();
    } catch (err: any) { alert(`Failed to apply edit: ${err.message}`); }
    finally { setLoading(false); }
  };

  const handleReject = async (id: string) => {
    setLoading(true);
    try {
      await api.rejectWorkspaceEdit(id);
      setActionSuccess('Proposed edit rejected.');
      setTimeout(() => setActionSuccess(null), 2500);
      await loadEdits();
    } catch (err: any) { alert(`Failed to reject edit: ${err.message}`); }
    finally { setLoading(false); }
  };

  const handleProposeTestEdit = async () => {
    if (!roots.length) { alert('Add an approved workspace root first.'); return; }
    const targetFile = `${roots[0].path}/jarvis-sample-skill.ts`;
    const sampleCode = `// JARVIS Self-Evolution Generated Module\nexport function customAssistantSubroutine(input: string) {\n  return { processed: true, result: \`Hello from JARVIS Future-Safe Boundary: \${input}\` };\n}`;
    try {
      await api.proposeWorkspaceEdit({ path: targetFile, content: sampleCode, reason: 'Self-evolution subroutine proposal' });
      setActionSuccess('Test edit proposed for human review!');
      setTimeout(() => setActionSuccess(null), 3000);
      await loadEdits();
    } catch (err: any) { alert(`Failed to propose edit: ${err.message}`); }
  };

  const pendingEdits = edits.filter((e) => e.status === 'pending_review');
  const pastEdits = edits.filter((e) => e.status !== 'pending_review');

  return <>
    <h2><Settings2 /> Workspace access</h2>
    <p className="muted">JARVIS can only read and write UTF-8 text files inside roots you explicitly approve.</p>
    <form className="root-form" onSubmit={add}>
      <input value={rootInput} onChange={(e) => setRootInput(e.target.value)} placeholder="Absolute folder path" />
      <button><FolderPlus /> Add root</button>
    </form>
    <div className="roots">
      {roots.map((root) => <div key={root.id}><FileText /><span>{root.path}</span><button onClick={() => remove(root.id)}><X /></button></div>)}
      {!roots.length && <p className="muted">No workspace roots are approved.</p>}
    </div>

    <div style={{ marginTop: 24, borderTop: '1px solid #1f3442', paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 style={{ margin: 0, color: '#53d4ff', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
          FUTURE-SAFE BOUNDARY
        </h3>
        <span style={{ fontSize: 11, background: '#0a1825', color: '#52d4fb', padding: '4px 8px', borderRadius: 6, border: '1px solid #2e5064' }}>
          Human-in-the-Loop Active
        </span>
      </div>

      <p className="muted">
        Skills and self-evolution routines may propose code edits for review, but cannot execute or write files without explicit human approval.
      </p>

      {actionSuccess && (
        <div style={{ background: '#064e3b', color: '#6ee7b7', border: '1px solid #047857', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12 }}>
          {actionSuccess}
        </div>
      )}

      <button onClick={handleProposeTestEdit} style={{ margin: '12px 0 18px', background: '#142b3a', color: '#53d4ff', border: '1px solid #295166', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }}>
        + Propose Test Workspace Code Edit
      </button>

      <h4>Pending Review Queue ({pendingEdits.length})</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '10px 0' }}>
        {pendingEdits.map((edit) => (
          <div key={edit.id} style={{ background: '#0c1b29', border: '1px solid #2e5064', borderRadius: 10, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 'bold', color: '#edf6ff', fontFamily: 'monospace' }}>{edit.file_path}</span>
              <span style={{ fontSize: 10, background: '#7c2d12', color: '#ffedd5', padding: '2px 6px', borderRadius: 4 }}>Pending Approval</span>
            </div>
            <p style={{ fontSize: 11, color: '#9db2c3', margin: '4px 0 8px' }}>Reason: {edit.reason}</p>
            <pre style={{ background: '#06111a', border: '1px solid #1f3442', padding: 10, borderRadius: 6, fontSize: 11, color: '#a7f3d0', overflowX: 'auto', maxHeight: 120 }}>{edit.content}</pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button disabled={loading} onClick={() => handleApprove(edit.id)} style={{ background: '#059669', color: '#ffffff', fontWeight: 'bold', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                Approve & Write File
              </button>
              <button disabled={loading} onClick={() => handleReject(edit.id)} style={{ background: '#334155', color: '#cbd5e1', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
                Reject
              </button>
            </div>
          </div>
        ))}
        {!pendingEdits.length && <p className="muted" style={{ fontSize: 12 }}>No file edits currently pending human review.</p>}
      </div>

      {pastEdits.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h4>Audit History ({pastEdits.length})</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pastEdits.map((edit) => (
              <div key={edit.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '6px 0', borderBottom: '1px solid #1f3442', color: '#9db2c3' }}>
                <span style={{ fontFamily: 'monospace' }}>{edit.file_path}</span>
                <span style={{ color: edit.status === 'approved_and_applied' ? '#34d399' : '#f87171' }}>{edit.status === 'approved_and_applied' ? 'Approved & Applied' : 'Rejected'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  </>;
}

