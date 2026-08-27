#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { useEffect, useRef, useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { DaemonClient } from '../lib/daemon-client.mjs';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [command = 'tui', ...args] = process.argv.slice(2);

// Version and help output do not require daemon connectivity.
if (command === 'version' || command === '--version' || command === '-v') { await printVersion(); process.exit(0); }
if (command === 'help' || command === '--help' || command === '-h') { printHelp(); process.exit(0); }

// The daemon is opened on first use, not before dispatch, so a command that
// rejects its own arguments never starts or waits for one. Streaming methods
// keep their async-iterable shape; every other call resolves through the same
// single connection.
let connection;
const connect = async () => (connection ??= await DaemonClient.connect());
const STREAMING = new Set(['chat', 'events']);
// The interactive surfaces draw only once a daemon answers: a session that
// renders and then fails every request reads as working when it is not.
const connectOrExit = async () => {
  try { return await connect(); } catch (error) { console.error(error.message); process.exit(1); }
};
const client = new Proxy({}, {
  get: (_target, method) => (STREAMING.has(method)
    ? async function* (...args) { yield* (await connect())[method](...args); }
    : (...args) => connect().then((daemon) => daemon[method](...args)))
});

// A command reports success only when the operation it ran completed. Each
// handler returns nothing on success or throws; a failed turn or run sets the
// exit status itself.
if (command === 'doctor') { console.log(JSON.stringify(await client.diagnostics(), null, 2)); }
else if (command === 'daemon') { console.log(JSON.stringify(await client.health(), null, 2)); }
else if (command === 'ask') { await ask(args); }
else if (command === 'agent' || command === 'agents') { await agentCommand(command === 'agents' ? ['list', ...args] : args); }
else if (command === 'mcp') { await mcpCommand(args); }
else if (command === 'skills') { await skillsCommand(args); }
else if (command === 'settings') { await settingsCommand(args); }
else if (command === 'workspace') { await workspace(args); }
else if (command === 'serve') { console.log(`Daemon active at ${(await connect()).base}`); }
else if (process.stdout.isTTY) render(React.createElement(Tui, { client: await connectOrExit() }));
else { await connectOrExit(); await repl(); }

// ---- Flag parsing -----------------------------------------------------
// Supports --flag, --flag=value, and --flag value; `--` remains positional.
function parseArgs(list, { valueFlags = [] } = {}) {
  const positional = [];
  const values = {};
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i];
    if (arg === '--') { positional.push(arg); continue; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) { values[name] = arg.slice(eq + 1); }
      else if (valueFlags.includes(name)) { values[name] = list[i + 1]; i += 1; }
      else { values[name] = true; }
    } else positional.push(arg);
  }
  return { positional, values };
}
async function readStdin() { const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk); return Buffer.concat(chunks).toString('utf8'); }

// ---- CLI-only commands (no daemon connection required) ----------------
async function printVersion() { const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8')); console.log(pkg.version); }
function printHelp() {
  console.log([
    'Usage: jarvis <command> [args]',
    '',
    '  ask "<message>"    Ask JARVIS once and exit (scriptable). Reads stdin if no',
    '                      message is given and stdin is not a TTY.',
    '                      [--provider <id>] [--model <name>] [--json]',
    '                      [--allow-cloud] [--allow-tools] [--resume <id>|--continue]',
    '  agent list          List agent profiles',
    '  agent run <id> "<objective>" [--allow-cloud] [--approve] [--conversation <id>] [--json]',
    '  agent panel a1 a2 -- "<objective>"   Run a synthesized multi-agent panel',
    '  agent debate a1 a2 -- "<objective>"  Run a bounded 2-round debate',
    '  mcp list | add <name> <endpoint> [--type http|stdio] | remove <id> | ping <id>',
    '  skills list | import <owner/repo[/path]> | export <id> [--out <file>] | toggle <id> | remove <id>',
    '  settings [get] | settings mode <auto|local_only|cloud_only|provider:<id>>',
    '  workspace list | add <path> | remove <id>',
    '  doctor              Print live system hardware & runtime diagnostics',
    '  daemon              Print daemon health',
    '  serve               Print the running daemon\'s base URL',
    '  version             Print the JARVISvX CLI version',
    '  (no command)        Launch the interactive TUI (or a REPL notice if not a TTY)',
    '',
    'Inside the TUI, type /help for the full list of interactive slash commands.'
  ].join('\n'));
}

// ---- Daemon-backed commands ---------------------------------------------
async function ask(rawArgs) {
  const { positional, values } = parseArgs(rawArgs, { valueFlags: ['provider', 'model', 'resume'] });
  let content = positional.join(' ').trim();
  if (!content && !process.stdin.isTTY) content = (await readStdin()).trim();
  if (!content) throw new Error('Usage: jarvis ask "message" [--provider <id>] [--model <name>] [--json] [--allow-cloud] [--allow-tools] [--resume <id>|--continue]');
  let conversationId;
  if (values.resume) conversationId = (await client.conversation(values.resume))?.id;
  else if (values.continue) conversationId = (await client.conversations())[0]?.id;
  const approvals = await client.approvals(
    values['allow-cloud'] && { action: 'provider.cloud', target: values.provider || 'auto' },
    values['allow-tools'] && { action: 'capability.mutate', target: 'any' },
  );
  const payload = { content, conversationId, providerId: values.provider, model: values.model, approvals, origin: 'cli' };
  // A turn that ends in error or cancellation is a failed command, in both
  // output modes.
  let failure = null;
  for await (const event of client.chat(payload)) {
    if (event.type === 'error' || event.type === 'cancelled') failure = event.message || event.type;
    if (values.json) { console.log(JSON.stringify(event)); continue; }
    if (event.type === 'token') process.stdout.write(event.value);
    if (event.type === 'error') console.error(`\nError: ${event.message}`);
    if (event.type === 'cancelled') console.error(`\nCancelled: ${event.message || 'The turn was cancelled.'}`);
  }
  if (!values.json) process.stdout.write('\n');
  if (failure) process.exitCode = 1;
}
async function agentCommand(list) {
  const [action, ...rest] = list;
  if (action === 'list') { const agents = await client.agents(); console.log(agents.map((a) => `${a.id.padEnd(12)} ${a.name.padEnd(14)} adapter:${a.adapter}${a.cli ? `/${a.cli}` : ''}  voice:${a.voice}${a.isBuiltIn ? '' : '  (custom)'}${a.available === false ? '  [unavailable: CLI not installed for this session]' : ''}`).join('\n') || 'No agents configured.'); return; }
  if (action === 'run') {
    const { positional, values } = parseArgs(rest, { valueFlags: ['conversation'] });
    const [agentId, ...objectiveParts] = positional;
    const objective = objectiveParts.join(' ');
    if (!agentId || !objective) throw new Error('Usage: jarvis agent run <agentId> "<objective>" [--allow-cloud] [--approve] [--conversation <id>] [--json]');
    const approvals = await client.approvals(
      values.approve && { action: 'agent.privileged', target: agentId },
      values['allow-cloud'] && { action: 'provider.cloud', target: 'auto' },
    );
    const run = await client.runAgent({ agentId, objective, mode: 'solo', conversationId: values.conversation, approvals });
    console.log(values.json ? JSON.stringify(run, null, 2) : (run.result || 'Agent run complete.'));
    if (run.status === 'failed') process.exitCode = 1;
    return;
  }
  if (action === 'panel' || action === 'debate') {
    const { positional, values } = parseArgs(rest, { valueFlags: ['conversation'] });
    const sep = positional.indexOf('--');
    const agentIds = sep === -1 ? [] : positional.slice(0, sep);
    const objective = (sep === -1 ? [] : positional.slice(sep + 1)).join(' ');
    if (!agentIds.length || !objective) throw new Error(`Usage: jarvis agent ${action} agent1 agent2 -- "<objective>" [--allow-cloud] [--approve] [--json]`);
    const approvals = await client.approvals(
      ...(values.approve ? agentIds.map((id) => ({ action: 'agent.privileged', target: id })) : []),
      values['allow-cloud'] && { action: 'provider.cloud', target: 'auto' },
    );
    const run = await client.runAgent({ agentIds, objective, mode: action, conversationId: values.conversation, approvals });
    console.log(values.json ? JSON.stringify(run, null, 2) : (run.result || 'Agent run complete.'));
    if (run.status === 'failed') process.exitCode = 1;
    return;
  }
  throw new Error('Usage: jarvis agent <list|run <id> "<objective>"|panel a1 a2 -- "<objective>"|debate a1 a2 -- "<objective>">');
}
async function mcpCommand(list) {
  const [action, ...rest] = list;
  if (!action || action === 'list') { const servers = await client.mcpServers(); console.log(servers.map((s) => `${s.id.padEnd(14)} ${s.name.padEnd(28)} type:${s.type.padEnd(8)} status:${s.status}  ${s.endpoint}`).join('\n') || 'No MCP servers configured.'); return; }
  if (action === 'add') {
    const { positional, values } = parseArgs(rest, { valueFlags: ['type'] });
    const [name, endpoint] = positional;
    if (!name || !endpoint) throw new Error('Usage: jarvis mcp add <name> <endpoint> [--type http|stdio]');
    const server = await client.addMcpServer({ name, endpoint, type: values.type || 'http' });
    console.log(`Added: ${server.id}  ${server.name}`);
    return;
  }
  if (action === 'remove') { const [id] = rest; if (!id) throw new Error('Usage: jarvis mcp remove <id>'); await client.removeMcpServer(id); console.log(`Removed ${id}.`); return; }
  if (action === 'ping') { const [id] = rest; if (!id) throw new Error('Usage: jarvis mcp ping <id>'); console.log(JSON.stringify(await client.pingMcpServer(id), null, 2)); return; }
  throw new Error('Usage: jarvis mcp <list|add <name> <endpoint>|remove <id>|ping <id>>');
}
async function skillsCommand(list) {
  const [action, ...rest] = list;
  if (!action || action === 'list') { const skills = await client.skills(); console.log(skills.map((s) => `${s.slashCommand.padEnd(16)} ${s.name.padEnd(24)} ${s.enabled ? 'enabled ' : 'disabled'}  ${s.type}`).join('\n') || 'No skills configured.'); return; }
  if (action === 'import') { const [source] = rest; if (!source) throw new Error('Usage: jarvis skills import <owner/repo[/path]>'); const skill = await client.importSkill(source); console.log(`Imported: ${skill.slashCommand}  (${skill.name})`); return; }
  if (action === 'export') {
    const { positional, values } = parseArgs(rest, { valueFlags: ['out'] });
    const [id] = positional;
    if (!id) throw new Error('Usage: jarvis skills export <id> [--out <file>]');
    const { filename, content } = await client.exportSkill(id);
    if (values.out) { await fs.writeFile(values.out, content, 'utf8'); console.log(`Wrote ${values.out}`); }
    else if (process.stdout.isTTY) { await fs.writeFile(filename, content, 'utf8'); console.log(`Wrote ${filename}`); }
    else process.stdout.write(content);
    return;
  }
  if (action === 'toggle') { const [id] = rest; if (!id) throw new Error('Usage: jarvis skills toggle <id>'); const skill = await client.toggleSkill(id); console.log(`${skill.slashCommand}: ${skill.enabled ? 'enabled' : 'disabled'}`); return; }
  if (action === 'remove') { const [id] = rest; if (!id) throw new Error('Usage: jarvis skills remove <id>'); await client.removeSkill(id); console.log(`Removed ${id}.`); return; }
  throw new Error('Usage: jarvis skills <list|import <owner/repo>|export <id>|toggle <id>|remove <id>>');
}
async function settingsCommand(list) {
  const [action, ...rest] = list;
  if (!action || action === 'get') { console.log(JSON.stringify(await client.effectiveSettings(), null, 2)); return; }
  if (action === 'mode') { const [mode] = rest; if (!mode) throw new Error('Usage: jarvis settings mode <auto|local_only|cloud_only|provider:<id>>'); const updated = await client.setOrchestration({ mode }); console.log(`Mode: ${updated.mode}`); return; }
  throw new Error('Usage: jarvis settings [get|mode <auto|local_only|cloud_only|provider:<id>>]');
}
async function workspace([action, value]) { if (action === 'list') console.table(await client.json('/workspace-roots')); else if (action === 'add' && value) console.log((await client.json('/workspace-roots', { method: 'POST', body: JSON.stringify({ path: value }) })).path); else if (action === 'remove' && value) console.log(JSON.stringify(await client.json(`/workspace-roots/${value}`, { method: 'DELETE' }))); else console.error('Usage: jarvis workspace <list|add <path>|remove <id>>'); }
async function repl() { process.stderr.write('JARVIS CLI requires a TTY for the interactive interface. Use `jarvis ask "…"` for scripts.\n'); }

function Tui({ client }) {
  const { exit } = useApp(); const [input, setInput] = useState(''); const [lines, setLines] = useState([]); const [conversation, setConversation] = useState(null); const [status, setStatus] = useState('connecting'); const [provider, setProvider] = useState('default'); const [routed, setRouted] = useState(''); const [model, setModel] = useState(''); const [voiceState, setVoiceState] = useState('connecting'); const [cloudApproved, setCloudApproved] = useState(false); const [agentApproved, setAgentApproved] = useState(false); const [toolsApproved, setToolsApproved] = useState(false); const activeTurn = useRef(null);
  useEffect(() => { client.providers().then((data) => { setModel(data.settings.activeModel || ''); setStatus('ready'); }).catch((error) => setStatus(error.message)); client.voice().then((voice) => setVoiceState(voice.state)).catch(() => setVoiceState('unavailable')); }, []);
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
        // Approval covers one agent run; the flags clear as the request is submitted.
        const wantsAgent = agentApproved;
        const wantsCloud = cloudApproved;
        setAgentApproved(false);
        setCloudApproved(false);
        try {
          const approvals = await client.approvals(
            wantsAgent && { action: 'agent.privileged', target: agentId },
            wantsCloud && { action: 'provider.cloud', target: 'auto' },
          );
          const run = await client.json('/agents/run', {
            method: 'POST',
            body: JSON.stringify({ agentId, objective: prompt, mode: 'solo', conversationId: conversation?.id, approvals })
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
    const wantsCloud = cloudApproved;
    const wantsTools = toolsApproved;
    setCloudApproved(false);
    setToolsApproved(false);
    try {
      const approvals = await client.approvals(
        wantsCloud && { action: 'provider.cloud', target: provider === 'default' ? 'auto' : provider },
        wantsTools && { action: 'capability.mutate', target: 'any' },
      );
      for await (const event of client.chat({ content, conversationId, providerId: provider === 'default' ? undefined : provider, model: model || undefined, approvals, origin: 'cli' })) {
        if (event.type === 'start') { conversationId = event.conversationId; activeTurn.current = conversationId; setConversation({ id: conversationId }); setRouted(`${event.provider}${event.model ? `/${event.model}` : ''}`); }
        if (event.type === 'token') setLines((items) => items.map((item, index) => index === items.length - 1 ? { ...item, content: item.content + event.value } : item));
        if (event.type === 'tool-call') setLines((items) => [...items, { role: 'system', content: `Running ${event.name}…` }, { role: 'jarvis', content: '' }]);
        if (event.type === 'tool-result') setLines((items) => [...items.slice(0, -1), { role: 'system', content: `${event.name} → ${(event.output || '').slice(0, 400)}` }, { role: 'jarvis', content: '' }]);
        if (event.type === 'tool-approval-required') setLines((items) => [...items.slice(0, -1), { role: 'system', content: `JARVIS wants to run "${event.name}", which needs approval. Run /approve-tools then resend your message.` }]);
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
        const wantsAgent = agentApproved;
        const wantsCloud = cloudApproved;
        setAgentApproved(false);
        setCloudApproved(false);
        try {
          const approvals = await client.approvals(
            ...(wantsAgent ? agentIds.map((id) => ({ action: 'agent.privileged', target: id })) : []),
            wantsCloud && { action: 'provider.cloud', target: 'auto' },
          );
          const run = await client.json('/agents/run', {
            method: 'POST',
            body: JSON.stringify({ agentIds, objective, mode: name, conversationId: conversation?.id, approvals })
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
      // Provider selection is local to the TUI and is submitted with each turn.
      if (name === 'provider') { setProvider(rest[0] || 'default'); setModel(''); return; }
      if (name === 'model') { if (!rest[0]) return setLines((items) => [...items, { role: 'system', content: `Model: ${model || 'not selected'}` }]); await client.setModel(provider, rest.join(' ')); setModel(rest.join(' ')); return; }
      if (name === 'approve-cloud') { setCloudApproved(true); return setLines((items) => [...items, { role: 'system', content: 'Cloud approved for the next turn or agent run only.' }]); }
      if (name === 'approve-agent') { setAgentApproved(true); return setLines((items) => [...items, { role: 'system', content: 'Privileged agent capabilities approved for the next agent run only.' }]); }
      if (name === 'approve-tools') { setToolsApproved(true); return setLines((items) => [...items, { role: 'system', content: 'Tool writes (file writes, MCP actions that change state) approved for the next turn only.' }]); }
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
        '/provider [id]     Pin a provider by id (from /settings); no id returns to Automatic',
        '/model [id]        Get or set active model weights',
        '/voice [id]        Get or set local Kokoro voice persona',
        '/listen            Enable voice wake word listening',
        '/mute              Mute voice wake word listening',
        '/interrupt         Stop active assistant turn or playback',
        '/approve-cloud     Approve cloud escalation for the next prompt or agent run',
        '/approve-agent     Approve privileged agent capabilities for the next agent run',
        '/approve-tools     Approve tool writes (file writes, MCP actions) for the next prompt',
        '/doctor            Display live system hardware & runtime diagnostics',
        '/workspace         Manage approved workspace folder roots (list | add <path>)',
        '/settings          Print current active daemon & voice settings',
        '/exit              Exit the CLI session',
        '',
        'For scripting/CI, exit the TUI and use top-level subcommands instead —',
        'run `jarvis --help` outside this session (ask/agent/mcp/skills/settings).'
      ].join('\n') }]);
      setLines((items) => [...items, { role: 'error', content: `Unknown or incomplete command: /${name}` }]);
    } catch (error) {
      setLines((items) => [...items, { role: 'error', content: error.message }]);
    }
  };
  return React.createElement(Box, { flexDirection: 'column', padding: 1 }, React.createElement(Text, { color: 'cyan', bold: true }, 'JARVISvX  ', React.createElement(Text, { color: status === 'ready' ? 'green' : 'yellow' }, status), `  voice:${voiceState}  provider:${provider === 'default' ? `Automatic${routed ? ` → ${routed}` : ''}` : `${provider}${model ? `/${model}` : ''}`}  ${conversation ? `session:${conversation.id.slice(0, 8)}` : 'new session'}`), React.createElement(Box, { flexDirection: 'column', marginTop: 1 }, lines.slice(-20).map((line, index) => React.createElement(Box, { key: `${index}-${line.content.slice(0, 12)}`, flexDirection: 'column' }, React.createElement(Text, { color: line.role === 'you' ? 'cyan' : line.role === 'error' ? 'red' : line.role === 'system' || line.role === 'voice' ? 'yellow' : 'green', bold: true }, line.role.toUpperCase()), React.createElement(Text, null, line.content || '…')))), React.createElement(Box, { marginTop: 1 }, React.createElement(Text, { color: 'cyan' }, '> '), React.createElement(TextInput, { value: input, onChange: setInput, onSubmit: submit, placeholder: 'Ask JARVIS or type /help' })), React.createElement(Text, { dimColor: true }, 'Voice events are live · Esc interrupts active work · Ctrl+C exits · /help commands'));
}
