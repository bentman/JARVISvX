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
  const getStateTheme = (s: string) => {
    switch (s) {
      case 'capturing':
        return {
          gradient: 'radial-gradient(circle at 35% 35%, #59ddab 0%, #10b981 50%, #064e3b 100%)',
          shadow: '0 0 45px rgba(89, 221, 171, 0.45)',
          border: '1px solid rgba(89, 221, 171, 0.5)'
        };
      case 'transcribing':
      case 'thinking':
        return {
          gradient: 'radial-gradient(circle at 35% 35%, #c084fc 0%, #a855f7 50%, #581c87 100%)',
          shadow: '0 0 45px rgba(168, 85, 247, 0.45)',
          border: '1px solid rgba(168, 85, 247, 0.5)'
        };
      case 'speaking':
        return {
          gradient: 'radial-gradient(circle at 35% 35%, #7ae0fc 0%, #0ea5e9 50%, #1e3a8a 100%)',
          shadow: '0 0 50px rgba(83, 212, 255, 0.5)',
          border: '1px solid rgba(83, 212, 255, 0.5)'
        };
      case 'interrupted':
        return {
          gradient: 'radial-gradient(circle at 35% 35%, #fb7185 0%, #f43f5e 50%, #881337 100%)',
          shadow: '0 0 45px rgba(244, 63, 94, 0.5)',
          border: '1px solid rgba(244, 63, 94, 0.5)'
        };
      case 'wake-listening':
      default:
        return {
          gradient: 'radial-gradient(circle at 35% 35%, #38bdf8 0%, #0369a1 60%, #0c1b29 100%)',
          shadow: '0 0 35px rgba(83, 212, 255, 0.25)',
          border: '1px solid rgba(83, 212, 255, 0.3)'
        };
    }
  };

  const theme = getStateTheme(state);
  const glowScale = 1 + Math.min(audioLevel * 0.2, 0.25);

  return (
    <div
      onClick={onOrbClick}
      className="relative flex flex-col items-center justify-center cursor-pointer select-none transition-all"
      title="Click to trigger voice capture / barge-in"
      style={{ width: size, height: size }}
    >
      <div
        className="rounded-full flex items-center justify-center transition-all duration-300"
        style={{
          width: size,
          height: size,
          background: theme.gradient,
          boxShadow: theme.shadow,
          border: theme.border,
          transform: `scale(${glowScale})`
        }}
      >
        <div
          className="rounded-full shadow-inner"
          style={{
            width: `${size * 0.45}px`,
            height: `${size * 0.45}px`,
            background: 'rgba(255, 255, 255, 0.22)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)'
          }}
        />
      </div>
    </div>
  );
}
