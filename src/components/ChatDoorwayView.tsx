import React, { useState, useRef, useEffect } from 'react';
import { Message, PersonaConfig, ExecutionStep } from '../types';
import {
  Send,
  Mic,
  Volume2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Terminal,
  Cpu,
  Search,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Zap,
  Bot,
  User
} from 'lucide-react';

interface ChatDoorwayViewProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  persona: PersonaConfig;
  onSpeakText: (text: string) => void;
  isListening: boolean;
  onToggleDictation: () => void;
  isLoading: boolean;
}

export const ChatDoorwayView: React.FC<ChatDoorwayViewProps> = ({
  messages,
  onSendMessage,
  persona,
  onSpeakText,
  isListening,
  onToggleDictation,
  isLoading
}) => {
  const [inputText, setInputText] = useState('');
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openStepsMap, setOpenStepsMap] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const slashCommands = [
    { cmd: '/search', desc: 'Query live search grounding via Gemini or Local Index' },
    { cmd: '/calc', desc: 'Safely evaluate mathematical and algebraic expressions' },
    { cmd: '/hardware', desc: 'Inspect device CPU cores, RAM, WebGPU tier, and LLM speed' },
    { cmd: '/mcp', desc: 'Query registered Model Context Protocol servers and tools' },
    { cmd: '/code', desc: 'Trigger JARVIS self-evolution code generator' },
    { cmd: '/escalate', desc: 'Explicitly route query to Gemini 3.6 Flash / Pro cloud reasoning' }
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (val.startsWith('/')) {
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  };

  const handleSelectSlashCommand = (cmd: string) => {
    setInputText(cmd + ' ');
    setShowSlashMenu(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText.trim());
    setInputText('');
    setShowSlashMenu(false);
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleSteps = (msgId: string) => {
    setOpenStepsMap((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-70px)] bg-[#0a0a0b] text-slate-100 max-w-6xl mx-auto border-x border-white/5 shadow-2xl">
      {/* Top Context Bar */}
      <div className="px-6 py-3 border-b border-subtle glass flex items-center justify-between text-xs font-mono text-slate-400">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full animate-pulse glow-cyan"
            style={{ backgroundColor: persona.accentColor }}
          />
          <span>Active Persona: <strong className="text-slate-200">{persona.name}</strong></span>
        </div>
        <div className="flex items-center gap-3">
          <span>Target Mode: <strong className="text-cyan-400">Local First / Cloud Standby</strong></span>
          <span>Messages: {messages.length}</span>
        </div>
      </div>

      {/* Message List Stream */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 scrollbar-thin scrollbar-thumb-slate-800">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          const isSystem = msg.sender === 'system';
          const showSteps = openStepsMap[msg.id];

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-2">
                <div className="bg-slate-900/90 border border-slate-800 text-slate-400 text-xs font-mono px-4 py-1.5 rounded-full flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>{msg.text}</span>
                </div>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex gap-3 sm:gap-4 ${isUser ? 'justify-end' : 'justify-start'}`}
            >
              {!isUser && (
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center font-mono font-bold text-sm shrink-0 border border-cyan-500/30 shadow-md"
                  style={{
                    backgroundColor: `${persona.accentColor}20`,
                    color: persona.accentColor
                  }}
                >
                  {persona.avatarSymbol}
                </div>
              )}

              <div className={`max-w-[85%] sm:max-w-[75%] space-y-2`}>
                {/* Sender Header */}
                <div className={`flex items-center gap-2 text-xs font-mono text-slate-400 ${isUser ? 'justify-end' : 'justify-start'}`}>
                  <span>{isUser ? 'User' : persona.name}</span>
                  <span>•</span>
                  <span>{msg.timestamp}</span>
                  {msg.modelUsed && (
                    <span className="text-[10px] bg-slate-900 px-2 py-0.5 rounded text-cyan-300 border border-slate-800">
                      {msg.modelUsed}
                    </span>
                  )}
                  {msg.isCloudEscalated && (
                    <span className="text-[10px] bg-purple-950 text-purple-300 px-2 py-0.5 rounded border border-purple-800/80 flex items-center gap-1">
                      <Sparkles className="w-2.5 h-2.5 text-purple-400" /> Escalated
                    </span>
                  )}
                </div>

                {/* Message Bubble Body */}
                <div
                  className={`p-4 rounded-2xl text-sm leading-relaxed ${
                    isUser
                      ? 'bg-cyan-600 text-slate-950 font-medium rounded-tr-none shadow-lg'
                      : 'bg-slate-900/90 text-slate-100 border border-slate-800 rounded-tl-none shadow-xl font-sans'
                  }`}
                >
                  <div className="whitespace-pre-wrap font-sans">{msg.text}</div>

                  {/* Actions Bar for JARVIS messages */}
                  {!isUser && (
                    <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs font-mono text-slate-400">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onSpeakText(msg.text)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 transition-colors"
                          title="Speak message audio"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>TTS</span>
                        </button>
                        <button
                          onClick={() => handleCopyText(msg.id, msg.text)}
                          className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      {/* Execution Steps Trigger */}
                      {msg.executionSteps && msg.executionSteps.length > 0 && (
                        <button
                          onClick={() => toggleSteps(msg.id)}
                          className="flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                          <span>{msg.executionSteps.length} Tool Runs</span>
                          {showSteps ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Execution Steps Expandable Accordion */}
                {!isUser && msg.executionSteps && msg.executionSteps.length > 0 && showSteps && (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 text-xs font-mono space-y-2 animate-fadeIn">
                    <div className="text-slate-400 font-bold border-b border-slate-800 pb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-amber-400" /> Execution Trace
                      </span>
                      <span className="text-[10px] text-slate-500">Local Orchestrator</span>
                    </div>
                    {msg.executionSteps.map((step, idx) => (
                      <div key={idx} className="bg-slate-950 p-2.5 rounded border border-slate-800/80 space-y-1">
                        <div className="flex items-center justify-between text-cyan-300">
                          <span className="font-bold">Tool: {step.tool}</span>
                          <span className="text-[10px] text-slate-500">{step.durationMs}ms</span>
                        </div>
                        <div className="text-slate-400">Input: <code className="text-slate-200">{step.input}</code></div>
                        <div className="text-emerald-400">Output: <code className="text-slate-300">{step.output}</code></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {isUser && (
                <div className="w-9 h-9 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-mono font-bold text-sm shrink-0 border border-cyan-500/40">
                  U
                </div>
              )}
            </div>
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-3 text-cyan-400 font-mono text-xs animate-pulse p-4 bg-slate-900/60 rounded-xl border border-slate-800 max-w-sm">
            <Bot className="w-4 h-4 text-cyan-400 animate-spin" />
            <span>JARVIS is orchestrating reasoning steps...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Doorway Bar */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-900/80 relative">
        {/* Slash Command Autocomplete Popover */}
        {showSlashMenu && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-slate-900 border border-cyan-500/40 rounded-xl shadow-2xl overflow-hidden z-30 font-mono max-h-56 overflow-y-auto">
            <div className="px-3 py-1.5 text-[11px] text-slate-400 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <span>AVAILABLE SLASH SKILLS</span>
              <span>Tap to select</span>
            </div>
            {slashCommands.map((sc, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelectSlashCommand(sc.cmd)}
                className="w-full px-4 py-2 text-left hover:bg-slate-800 flex items-center justify-between text-xs transition-colors border-b border-slate-800/50 last:border-0"
              >
                <span className="font-bold text-cyan-300">{sc.cmd}</span>
                <span className="text-slate-400 text-[11px]">{sc.desc}</span>
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          {/* Voice Dictation Trigger */}
          <button
            type="button"
            onClick={onToggleDictation}
            className={`p-3 rounded-xl border font-mono text-xs transition-all ${
              isListening
                ? 'bg-rose-600 text-white border-rose-500 animate-pulse'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700/80'
            }`}
            title="Toggle voice input dictation"
          >
            <Mic className="w-4 h-4" />
          </button>

          {/* Main Input Textfield */}
          <div className="relative flex-1">
            <input
              type="text"
              value={inputText}
              onChange={handleInputChange}
              placeholder="Ask JARVIS anything or type '/' for slash skills..."
              className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl px-4 py-3 text-sm text-slate-100 placeholder-slate-500 font-sans focus:outline-none shadow-inner"
            />
          </div>

          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="px-5 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-mono text-sm font-bold flex items-center gap-2 transition-all shadow-lg shadow-cyan-500/10"
          >
            <span>Send</span>
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
