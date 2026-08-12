import React from 'react';

interface VoiceOrbProps {
  state?: string;
  audioLevel?: number; // 0.0 to 1.0
  onOrbClick?: () => void;
  size?: number;
}

export function VoiceOrb({
  state = 'wake-listening',
  audioLevel = 0,
  onOrbClick,
  size = 200
}: VoiceOrbProps) {
  // Color palette for soft ambient glow based on state
  const getStateColors = (s: string) => {
    switch (s) {
      case 'capturing':
        return {
          core: 'from-emerald-400 to-emerald-600',
          glow: 'shadow-[0_0_60px_rgba(16,185,129,0.45)]',
          border: 'border-emerald-500/40',
          badgeBg: 'bg-emerald-950/80 text-emerald-300 border-emerald-800'
        };
      case 'transcribing':
      case 'thinking':
        return {
          core: 'from-purple-400 to-indigo-600',
          glow: 'shadow-[0_0_60px_rgba(168,85,247,0.45)]',
          border: 'border-purple-500/40',
          badgeBg: 'bg-purple-950/80 text-purple-300 border-purple-800'
        };
      case 'speaking':
        return {
          core: 'from-cyan-400 to-blue-600',
          glow: 'shadow-[0_0_60px_rgba(59,130,246,0.5)]',
          border: 'border-cyan-500/40',
          badgeBg: 'bg-cyan-950/80 text-cyan-300 border-cyan-800'
        };
      case 'interrupted':
        return {
          core: 'from-rose-400 to-rose-600',
          glow: 'shadow-[0_0_60px_rgba(244,63,94,0.5)]',
          border: 'border-rose-500/40',
          badgeBg: 'bg-rose-950/80 text-rose-300 border-rose-800'
        };
      case 'wake-listening':
      default:
        return {
          core: 'from-cyan-500 to-slate-700',
          glow: 'shadow-[0_0_45px_rgba(6,182,212,0.25)]',
          border: 'border-cyan-500/30',
          badgeBg: 'bg-cyan-950/60 text-cyan-300 border-cyan-900'
        };
    }
  };

  const colors = getStateColors(state);
  const glowScale = 1 + Math.min(audioLevel * 0.15, 0.2);

  return (
    <div
      onClick={onOrbClick}
      className="relative flex flex-col items-center justify-center cursor-pointer select-none group transition-all"
      title="Click to trigger voice capture / barge-in"
    >
      {/* Soft Ambient Glow Container - No fast animations */}
      <div
        className={`relative rounded-full bg-gradient-to-tr ${colors.core} ${colors.glow} border ${colors.border} transition-all duration-300 flex items-center justify-center`}
        style={{
          width: size,
          height: size,
          transform: `scale(${glowScale})`
        }}
      >
        {/* Inner Subtle Core Highlight */}
        <div className="w-1/2 h-1/2 rounded-full bg-white/20 backdrop-blur-sm shadow-inner" />
      </div>
    </div>
  );
}
