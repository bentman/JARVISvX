#!/usr/bin/env node
import 'dotenv/config';
import React, { useEffect, useRef, useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { DaemonClient } from '../lib/daemon-client.mjs';

const [command = 'tui', ...args] = process.argv.slice(2);
const client = await DaemonClient.connect();

if (command === 'doctor') { console.log(JSON.stringify(await client.diagnostics(), null, 2)); process.exitCode = 0; }
else if (command === 'daemon') { console.log(JSON.stringify(await client.health(), null, 2)); process.exitCode = 0; }
else if (command === 'ask') { await ask(args.join(' ')); process.exitCode = 0; }
else if (command === 'workspace') { await workspace(args); process.exitCode = 0; }
else if (command === 'serve') { console.log(`Daemon active at ${client.base}`); }
else if (process.stdout.isTTY) render(React.createElement(Tui, { client }));
else { await repl(); process.exitCode = 0; }

async function ask(content) { if (!content.trim()) throw new Error('Usage: jarvis ask "message"'); for await (const event of client.chat({ content, providerId: undefined, origin: 'cli' })) { if (event.type === 'token') process.stdout.write(event.value); if (event.type === 'error') console.error(`\nError: ${event.message}`); } process.stdout.write('\n'); }
async function workspace([action, value]) { if (action === 'list') console.table(await client.json('/workspace-roots')); else if (action === 'add' && value) console.log((await client.json('/workspace-roots', { method: 'POST', body: JSON.stringify({ path: value }) })).path); else if (action === 'remove' && value) console.log(JSON.stringify(await client.json(`/workspace-roots/${value}`, { method: 'DELETE' }))); else console.error('Usage: jarvis workspace <list|add <path>|remove <id>>'); }
async function repl() { process.stderr.write('JARVIS CLI requires a TTY for the interactive interface. Use `jarvis ask "…"` for scripts.\n'); }

function Tui({ client }) {
  const { exit } = useApp(); const [input, setInput] = useState(''); const [lines, setLines] = useState([]); const [conversation, setConversation] = useState(null); const [status, setStatus] = useState('connecting'); const [provider, setProvider] = useState('default'); const [model, setModel] = useState(''); const [voiceState, setVoiceState] = useState('connecting'); const [cloudApproved, setCloudApproved] = useState(false); const activeTurn = useRef(null);
  useEffect(() => { client.providers().then((data) => { setProvider(data.settings.activeProvider); setModel(data.settings.activeModel || ''); setStatus('ready'); }).catch((error) => setStatus(error.message)); client.voice().then((voice) => setVoiceState(voice.state)).catch(() => setVoiceState('unavailable')); }, []);
  useEffect(() => { const controller = new AbortController(); void (async () => { try { for await (const event of client.events(controller.signal)) { if (event.type === 'voice-state') { setVoiceState(event.state); continue; } if (event.type === 'partial-transcript' || event.type === 'final-transcript') { setLines((items) => [...items, { role: 'voice', content: `${event.type === 'partial-transcript' ? 'Hearing' : 'Heard'}: ${event.text}` }]); continue; } if (event.type === 'playback') { setVoiceState(event.state === 'started' ? 'speaking' : event.state === 'complete' ? 'wake-listening' : voiceState); continue; } if (event.type === 'token' && event.conversationId !== activeTurn.current) { setLines((items) => { const last = items.at(-1); return last?.role === 'jarvis' && last.remoteConversationId === event.conversationId ? [...items.slice(0, -1), { ...last, content: last.content + event.value }] : [...items, { role: 'jarvis', remoteConversationId: event.conversationId, content: event.value }]; }); } if (event.type === 'cancelled' && event.conversationId !== activeTurn.current) setLines((items) => [...items, { role: 'system', content: `Remote turn cancelled (${event.conversationId?.slice(0, 8) || 'unknown'}).` }]); } } catch (error) { if (!controller.signal.aborted) setStatus(`event stream: ${error.message}`); } })(); return () => controller.abort(); }, [client]);
  useInput((value, key) => { if (key.escape && conversation) void client.cancel(conversation.id); if (key.ctrl && value === 'c') exit(); });
  const submit = async (value) => {
    const content = value.trim();
    if (!content) return;
    setInput('');
    if (content.startsWith('/')) return commandLine(content);
    if (content.startsWith('@')) {
      const parts = content.slice(1).split(/\s+/);
      const agentId = parts[0];
      const prompt = parts.slice(1).join(' ');
      if (prompt) {
        setLines((items) => [...items, { role: 'you', content }, { role: 'jarvis', content: '' }]);
        try {
          const run = await client.json('/agents/run', {
            method: 'POST',
            body: JSON.stringify({ agentId, objective: prompt, mode: 'solo', conversationId: conversation?.id })
          });
          setLines((items) => [...items.slice(0, -1), { role: 'jarvis', content: run.result || 'Agent run complete.' }]);
        } catch (error) {
          setLines((items) => [...items, { role: 'error', content: error.message }]);
        }
        return;
      }
    }
    const user = { role: 'you', content };
    setLines((items) => [...items, user, { role: 'jarvis', content: '' }]);
    let conversationId = conversation?.id;
    const allowCloud = cloudApproved;
    setCloudApproved(false);
    try {
      for await (const event of client.chat({ content, conversationId, providerId: provider === 'default' ? undefined : provider, model: model || undefined, allowCloud, origin: 'cli' })) {
        if (event.type === 'start') { conversationId = event.conversationId; activeTurn.current = conversationId; setConversation({ id: conversationId }); }
        if (event.type === 'token') setLines((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + event.value } : item));
        if (event.type === 'error' || event.type === 'cancelled') setLines((items) => [...items, { role: 'system', content: event.message || 'Turn cancelled.' }]);
      }
    } catch (error) {
      setLines((items) => [...items, { role: 'error', content: error.message }]);
    } finally {
      activeTurn.current = null;
    }
  };
  const commandLine = async (content) => {
    const [name, ...rest] = content.slice(1).split(/\s+/);
    try {
      if (name === 'exit') return exit();
      if (name === 'new') { setConversation(null); return setLines([]); }
      if (name === 'sessions') { const sessions = await client.conversations(); return setLines((items) => [...items, { role: 'system', content: sessions.map((item) => `${item.id.slice(0, 8)}  ${item.title}`).join('\n') || 'No sessions.' }]); }
      if (name === 'resume') { const session = await client.conversation(rest[0]); setConversation(session); return setLines(session.messages.map((item) => ({ role: item.role === 'user' ? 'you' : 'jarvis', content: item.content }))); }
      if (name === 'doctor') { const report = await client.diagnostics(); return setLines((items) => [...items, { role: 'system', content: JSON.stringify(report, null, 2) }]); }
      if (name === 'agents') { const agents = await client.json('/agents'); return setLines((items) => [...items, { role: 'system', content: agents.map((a) => `@${a.id.padEnd(12)} (${a.name}) · ${a.description} [voice: ${a.voice}]`).join('\n') }]); }
      if (name === 'panel' || name === 'debate') {
        const rawArgs = rest.join(' ');
        const [agentsPart, ...objParts] = rawArgs.split('--');
        const agentIds = agentsPart ? agentsPart.trim().split(/\s+/).filter(Boolean) : [];
        const objective = objParts.join('--').trim();
        if (!objective) return setLines((items) => [...items, { role: 'error', content: `Usage: /${name} agent1 agent2 -- objective` }]);
        setLines((items) => [...items, { role: 'you', content: `/${name} ${rawArgs}` }, { role: 'jarvis', content: `Running multi-agent ${name}...\n` }]);
        try {
          const run = await client.json('/agents/run', {
            method: 'POST',
            body: JSON.stringify({ agentIds, objective, mode: name, conversationId: conversation?.id })
          });
          setLines((items) => [...items.slice(0, -1), { role: 'jarvis', content: run.result }]);
        } catch (error) {
          setLines((items) => [...items, { role: 'error', content: error.message }]);
        }
        return;
      }
      if (name === 'voice') { if (rest[0]) await client.setVoice(rest[0]); const voice = await client.voice(); return setLines((items) => [...items, { role: 'system', content: `Voice: ${voice.voice}; ${voice.message}` }]); }
      if (name === 'listen' || name === 'mute') { await client.setListening(name === 'listen'); return setLines((items) => [...items, { role: 'system', content: name === 'listen' ? 'Listening enabled.' : 'Listening muted.' }]); }
      if (name === 'interrupt' && conversation) { await client.cancel(conversation.id); return; }
      if (name === 'provider' && rest[0]) { await client.setProvider(rest[0]); setProvider(rest[0]); setModel(''); return; }
      if (name === 'model') { if (!rest[0]) return setLines((items) => [...items, { role: 'system', content: `Model: ${model || 'not selected'}` }]); await client.setModel(provider, rest.join(' ')); setModel(rest.join(' ')); return; }
      if (name === 'approve-cloud') { setCloudApproved(true); return setLines((items) => [...items, { role: 'system', content: 'Cloud approved for the next turn only.' }]); }
      if (name === 'workspace') { const [action, value] = rest; if (action === 'list') { const roots = await client.json('/workspace-roots'); return setLines((items) => [...items, { role: 'system', content: roots.map((root) => `${root.id.slice(0, 8)}  ${root.path}`).join('\n') || 'No approved workspace roots.' }]); } if (action === 'add' && value) { const root = await client.json('/workspace-roots', { method: 'POST', body: JSON.stringify({ path: value }) }); return setLines((items) => [...items, { role: 'system', content: `Approved: ${root.path}` }]); } return setLines((items) => [...items, { role: 'error', content: 'Usage: /workspace list | /workspace add <absolute-path>' }]); }
      if (name === 'settings') { const settings = await client.providers(); const voice = await client.voice(); return setLines((items) => [...items, { role: 'system', content: JSON.stringify({ ...settings.settings, voice: { state: voice.state, voice: voice.voice } }, null, 2) }]); }
      if (name === 'help') return setLines((items) => [...items, { role: 'system', content: [
        '@<agent> <prompt> Start direct agent execution (e.g. @architect design plugin)',
        '/agents            List all project agent profiles & voice personas',
        '/panel a1 a2 -- obj Run panel of agents with synthesis',
        '/debate a1 a2 -- obj Run 2-round bounded debate with consensus synthesis',
        '/new               Start a fresh assistant conversation',
        '/sessions          List all historical conversations',
        '/resume <id>       Resume a past conversation by ID',
        '/provider <id>     Switch active provider (llamacpp | ollama | cloud)',
        '/model [id]        Get or set active model weights',
        '/voice [id]        Get or set local Kokoro voice persona',
        '/listen            Enable voice wake word listening',
        '/mute              Mute voice wake word listening',
        '/interrupt         Stop active assistant turn or playback',
        '/approve-cloud     Approve cloud escalation for the next prompt',
        '/doctor            Display live system hardware & runtime diagnostics',
        '/workspace         Manage approved workspace folder roots (list | add <path>)',
        '/settings          Print current active daemon & voice settings',
        '/exit              Exit the CLI session'
      ].join('\n') }]);
      setLines((items) => [...items, { role: 'error', content: `Unknown or incomplete command: /${name}` }]);
    } catch (error) {
      setLines((items) => [...items, { role: 'error', content: error.message }]);
    }
  };
  return React.createElement(Box, { flexDirection: 'column', padding: 1 }, React.createElement(Text, { color: 'cyan', bold: true }, 'JARVISvX  ', React.createElement(Text, { color: status === 'ready' ? 'green' : 'yellow' }, status), `  voice:${voiceState}  provider:${provider}${model ? `/${model}` : ''}  ${conversation ? `session:${conversation.id.slice(0, 8)}` : 'new session'}`), React.createElement(Box, { flexDirection: 'column', marginTop: 1 }, lines.slice(-20).map((line, index) => React.createElement(Box, { key: `${index}-${line.content.slice(0, 12)}`, flexDirection: 'column' }, React.createElement(Text, { color: line.role === 'you' ? 'cyan' : line.role === 'error' ? 'red' : line.role === 'system' || line.role === 'voice' ? 'yellow' : 'green', bold: true }, line.role.toUpperCase()), React.createElement(Text, null, line.content || '…')))), React.createElement(Box, { marginTop: 1 }, React.createElement(Text, { color: 'cyan' }, '> '), React.createElement(TextInput, { value: input, onChange: setInput, onSubmit: submit, placeholder: 'Ask JARVIS or type /help' })), React.createElement(Text, { dimColor: true }, 'Voice events are live · Esc interrupts active work · Ctrl+C exits · /help commands'));
}

