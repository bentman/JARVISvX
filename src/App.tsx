/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  ViewMode,
  PersonaId,
  PersonaConfig,
  HardwareProfile,
  ModelConfig,
  StorageConfig,
  MemoryItem,
  SkillModule,
  McpServer,
  Message,
  VoiceStatus
} from './types';
import {
  DEFAULT_PERSONAS,
  INITIAL_HARDWARE,
  INITIAL_MODEL_CONFIG,
  INITIAL_STORAGE_CONFIG,
  INITIAL_MEMORIES,
  INITIAL_SKILLS,
  INITIAL_MCP_SERVERS
} from './data/initialData';
import { Header } from './components/Header';
import { VoiceHudView } from './components/VoiceHudView';
import { ChatDoorwayView } from './components/ChatDoorwayView';
import { ModelOrchestrationView } from './components/ModelOrchestrationView';
import { MemoryCenterView } from './components/MemoryCenterView';
import { CliTerminalView } from './components/CliTerminalView';
import { McpSkillsView } from './components/McpSkillsView';
import { SelfEvolutionView } from './components/SelfEvolutionView';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewMode>('voice_hud');
  const [selectedPersonaId, setSelectedPersonaId] = useState<PersonaId>('jarvis');
  const [personas, setPersonas] = useState(DEFAULT_PERSONAS);
  const [hardware, setHardware] = useState<HardwareProfile>(INITIAL_HARDWARE);
  const [modelConfig, setModelConfig] = useState<ModelConfig>(INITIAL_MODEL_CONFIG);
  const [storageConfig, setStorageConfig] = useState<StorageConfig>(INITIAL_STORAGE_CONFIG);
  
  // Persistent Memories State
  const [memories, setMemories] = useState<MemoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('jarvis_memories');
      return saved ? JSON.parse(saved) : INITIAL_MEMORIES;
    } catch (e) {
      return INITIAL_MEMORIES;
    }
  });

  // Persistent Skills State
  const [skills, setSkills] = useState<SkillModule[]>(() => {
    try {
      const saved = localStorage.getItem('jarvis_skills');
      return saved ? JSON.parse(saved) : INITIAL_SKILLS;
    } catch (e) {
      return INITIAL_SKILLS;
    }
  });

  const [mcpServers, setMcpServers] = useState<McpServer[]>(INITIAL_MCP_SERVERS);

  // Chat Stream Messages
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome-1',
      sender: 'jarvis',
      text: DEFAULT_PERSONAS.jarvis.greeting,
      timestamp: new Date().toLocaleTimeString(),
      modelUsed: 'Llama-3.2-3B (Local Execution)',
      isCloudEscalated: false
    }
  ]);

  // Voice Interaction State Machine
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [isContinuousListening, setIsContinuousListening] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const activePersona = personas[selectedPersonaId] || personas.jarvis;

  // Web Speech Recognition Ref
  const recognitionRef = useRef<any>(null);

  // Save memories to local storage on change
  useEffect(() => {
    try {
      localStorage.setItem('jarvis_memories', JSON.stringify(memories));
    } catch (e) {}
  }, [memories]);

  // Save skills to local storage on change
  useEffect(() => {
    try {
      localStorage.setItem('jarvis_skills', JSON.stringify(skills));
    } catch (e) {}
  }, [skills]);

  // Fetch real server hardware specs on mount
  useEffect(() => {
    fetchHardwareSpecs();
  }, []);

  const fetchHardwareSpecs = async () => {
    try {
      const res = await fetch('/api/hardware-specs');
      if (res.ok) {
        const data = await res.json();
        setHardware((prev) => ({
          ...prev,
          cpuCores: data.cpuCores || prev.cpuCores,
          ramGB: data.ramGB || prev.ramGB,
          freeRamGB: data.freeRamGB,
          recommendedLocalModel: data.recommendedLocalModel || prev.recommendedLocalModel
        }));
      }
    } catch (e) {
      console.log('Hardware scan used client fallback values');
    }
  };

  // Initialize Web Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setVoiceStatus('listening');
      };

      recognition.onresult = (event: any) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setTranscript(currentTranscript);

        // Auto submit if final result
        if (event.results[event.results.length - 1].isFinal && currentTranscript.trim()) {
          handleUserQuery(currentTranscript.trim());
          setTranscript('');
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setVoiceStatus('idle');
      };

      recognition.onend = () => {
        if (isContinuousListening && voiceStatus !== 'speaking') {
          try {
            recognition.start();
          } catch (e) {}
        } else if (voiceStatus === 'listening') {
          setVoiceStatus('idle');
        }
      };

      recognitionRef.current = recognition;
    }
  }, [isContinuousListening, voiceStatus]);

  // Speech Synthesis Output
  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // stop current audio

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = selectedPersonaId === 'hal9000' ? 0.85 : 1.0;
      utterance.pitch = selectedPersonaId === 'friday' ? 1.1 : 0.95;

      utterance.onstart = () => {
        setVoiceStatus('speaking');
      };

      utterance.onend = () => {
        setVoiceStatus('idle');
        if (isContinuousListening) {
          try {
            recognitionRef.current?.start();
          } catch (e) {}
        }
      };

      utterance.onerror = () => {
        setVoiceStatus('idle');
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  // Immediate Interrupt Action
  const handleInterrupt = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }
    setVoiceStatus('interrupted');
    setTimeout(() => setVoiceStatus('idle'), 1500);
  };

  // Toggle Voice Capture
  const handleToggleListen = () => {
    if (voiceStatus === 'listening') {
      try {
        recognitionRef.current?.stop();
      } catch (e) {}
      setVoiceStatus('idle');
    } else {
      handleInterrupt();
      setTranscript('');
      try {
        recognitionRef.current?.start();
      } catch (e) {
        // Fallback simulation if mic unavailable
        setVoiceStatus('listening');
        setTimeout(() => {
          setTranscript('JARVIS run system diagnostic');
          setTimeout(() => {
            handleUserQuery('JARVIS run system diagnostic');
            setTranscript('');
          }, 1000);
        }, 1500);
      }
    }
  };

  // Main User Query Orchestrator
  const handleUserQuery = async (queryText: string) => {
    setIsLoading(true);
    setVoiceStatus('processing');

    const userMsg: Message = {
      id: `msg-usr-${Date.now()}`,
      sender: 'user',
      text: queryText,
      timestamp: new Date().toLocaleTimeString()
    };

    setMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: queryText,
          personaPrompt: activePersona.systemPrompt,
          personaName: activePersona.name,
          modelMode: modelConfig.mode,
          autoEscalateRules: modelConfig.autoEscalateRules
        })
      });

      const data = await res.json();

      const jarvisMsg: Message = {
        id: `msg-jarvis-${Date.now()}`,
        sender: 'jarvis',
        text: data.text || 'Request processed successfully.',
        timestamp: new Date().toLocaleTimeString(),
        modelUsed: data.modelUsed || 'Llama-3.2-3B (Local)',
        isCloudEscalated: Boolean(data.isCloudEscalated),
        executionSteps: data.executionSteps || []
      };

      setMessages((prev) => [...prev, jarvisMsg]);
      speakText(jarvisMsg.text);
    } catch (err: any) {
      const errorMsg: Message = {
        id: `msg-err-${Date.now()}`,
        sender: 'jarvis',
        text: `Local execution error encountered. ${err.message || ''}`,
        timestamp: new Date().toLocaleTimeString(),
        modelUsed: 'Fallback Logic Engine',
        isCloudEscalated: false
      };
      setMessages((prev) => [...prev, errorMsg]);
      setVoiceStatus('idle');
    } finally {
      setIsLoading(false);
    }
  };

  // Terminal Execution Adapter
  const handleTerminalCommand = async (cmd: string) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: cmd,
        personaPrompt: activePersona.systemPrompt,
        personaName: activePersona.name,
        modelMode: modelConfig.mode,
        autoEscalateRules: modelConfig.autoEscalateRules
      })
    });
    return res.json();
  };

  // Toggle Model Orchestration Mode
  const handleToggleModelMode = () => {
    setModelConfig((prev) => {
      const nextMode =
        prev.mode === 'auto' ? 'local_only' : prev.mode === 'local_only' ? 'cloud_only' : 'auto';
      return { ...prev, mode: nextMode };
    });
  };

  // Memory Handlers
  const handleAddMemory = (newItem: Omit<MemoryItem, 'id' | 'updatedAt'>) => {
    const item: MemoryItem = {
      ...newItem,
      id: `mem-${Date.now()}`,
      updatedAt: new Date().toISOString()
    };
    setMemories((prev) => [item, ...prev]);
  };

  const handleDeleteMemory = (id: string) => {
    setMemories((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearMemories = () => {
    setMemories([]);
  };

  // Skill Handlers
  const handleToggleSkill = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const handleInstallNewSkill = (newSkill: SkillModule) => {
    setSkills((prev) => [newSkill, ...prev]);
  };

  const lastJarvisMessage = [...messages].reverse().find((m) => m.sender === 'jarvis');

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Header Bar */}
      <Header
        currentView={currentView}
        onSelectView={setCurrentView}
        selectedPersona={activePersona}
        personas={personas}
        onSelectPersona={setSelectedPersonaId}
        voiceStatus={voiceStatus}
        hardware={hardware}
        modelMode={modelConfig.mode}
        onToggleModelMode={handleToggleModelMode}
      />

      {/* Main View Router */}
      <main className="flex-1">
        {currentView === 'voice_hud' && (
          <VoiceHudView
            persona={activePersona}
            voiceStatus={voiceStatus}
            onToggleListen={handleToggleListen}
            onInterrupt={handleInterrupt}
            lastMessage={lastJarvisMessage}
            transcript={transcript}
            onSendQuickCommand={handleUserQuery}
            isContinuousListening={isContinuousListening}
            onToggleContinuous={() => setIsContinuousListening(!isContinuousListening)}
          />
        )}

        {currentView === 'chat' && (
          <ChatDoorwayView
            messages={messages}
            onSendMessage={handleUserQuery}
            persona={activePersona}
            onSpeakText={speakText}
            isListening={voiceStatus === 'listening'}
            onToggleDictation={handleToggleListen}
            isLoading={isLoading}
          />
        )}

        {currentView === 'orchestration' && (
          <ModelOrchestrationView
            hardware={hardware}
            modelConfig={modelConfig}
            onUpdateModelConfig={setModelConfig}
            onRefreshHardware={fetchHardwareSpecs}
          />
        )}

        {currentView === 'memory' && (
          <MemoryCenterView
            memories={memories}
            onAddMemory={handleAddMemory}
            onDeleteMemory={handleDeleteMemory}
            onClearMemories={handleClearMemories}
            storageConfig={storageConfig}
            onUpdateStorageConfig={setStorageConfig}
          />
        )}

        {currentView === 'mcp_skills' && (
          <McpSkillsView
            mcpServers={mcpServers}
            skills={skills}
            onToggleSkill={handleToggleSkill}
          />
        )}

        {currentView === 'terminal' && (
          <CliTerminalView
            persona={activePersona}
            onExecuteCommand={handleTerminalCommand}
          />
        )}

        {currentView === 'self_evolution' && (
          <SelfEvolutionView onInstallNewSkill={handleInstallNewSkill} />
        )}
      </main>
    </div>
  );
}
