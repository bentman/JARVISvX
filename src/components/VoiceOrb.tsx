import React, { useEffect, useRef } from 'react';
import { VoiceStatus } from '../types';

interface VoiceOrbProps {
  status: VoiceStatus;
  accentColor: string;
  onClick?: () => void;
  size?: number;
}

export const VoiceOrb: React.FC<VoiceOrbProps> = ({
  status,
  accentColor = '#38bdf8',
  onClick,
  size = 280
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let tick = 0;

    // Particle nodes for orbital effect
    const particles = Array.from({ length: 48 }, (_, i) => ({
      angle: (i / 48) * Math.PI * 2,
      radiusOffset: Math.random() * 20 - 10,
      speed: (Math.random() * 0.02 + 0.01) * (i % 2 === 0 ? 1 : -1),
      size: Math.random() * 2.5 + 1.5
    }));

    const render = () => {
      tick += 0.03;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const baseRadius = (size / 2) * 0.55;

      // Pulse multiplier based on voice status
      let pulse = Math.sin(tick * 2) * 4;
      if (status === 'listening') {
        pulse = Math.sin(tick * 5) * 14 + Math.cos(tick * 3) * 8;
      } else if (status === 'speaking') {
        pulse = Math.sin(tick * 8) * 18 + Math.sin(tick * 12) * 10;
      } else if (status === 'processing') {
        pulse = Math.sin(tick * 4) * 6;
      } else if (status === 'interrupted') {
        pulse = Math.sin(tick * 15) * 5;
      }

      const currentRadius = baseRadius + pulse;

      // Outer glowing rings
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius * 1.35, 0, Math.PI * 2);
      ctx.strokeStyle = status === 'interrupted' ? '#ef4444' : `${accentColor}33`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 12]);
      ctx.stroke();
      ctx.restore();

      // Secondary spinning arc ring
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(status === 'processing' ? tick * 2 : tick * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, currentRadius * 1.18, 0, Math.PI * 1.2);
      ctx.strokeStyle = status === 'interrupted' ? '#ef4444' : accentColor;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Radial Core Gradient
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        baseRadius * 0.1,
        centerX,
        centerY,
        currentRadius * 1.2
      );

      if (status === 'interrupted') {
        gradient.addColorStop(0, 'rgba(239, 68, 68, 0.9)');
        gradient.addColorStop(0.5, 'rgba(239, 68, 68, 0.4)');
        gradient.addColorStop(1, 'rgba(239, 68, 68, 0)');
      } else if (status === 'listening') {
        gradient.addColorStop(0, 'rgba(16, 185, 129, 0.95)');
        gradient.addColorStop(0.5, 'rgba(16, 185, 129, 0.4)');
        gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');
      } else if (status === 'speaking') {
        gradient.addColorStop(0, accentColor);
        gradient.addColorStop(0.5, `${accentColor}66`);
        gradient.addColorStop(1, `${accentColor}00`);
      } else {
        gradient.addColorStop(0, `${accentColor}dd`);
        gradient.addColorStop(0.6, `${accentColor}33`);
        gradient.addColorStop(1, `${accentColor}00`);
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Particle Orbiters
      particles.forEach((p) => {
        p.angle += p.speed * (status === 'processing' ? 2.5 : 1);
        const pRadius = currentRadius + p.radiusOffset + Math.sin(tick + p.angle) * 6;
        const px = centerX + Math.cos(p.angle) * pRadius;
        const py = centerY + Math.sin(p.angle) * pRadius;

        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = status === 'interrupted' ? '#fca5a5' : '#ffffff';
        ctx.shadowBlur = 8;
        ctx.shadowColor = accentColor;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // Core Sparkle / Ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 0.35 + Math.sin(tick * 3) * 3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = status === 'speaking' ? 0.9 : 0.6;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [status, accentColor, size]);

  return (
    <div
      onClick={onClick}
      className="relative flex items-center justify-center cursor-pointer group"
      title="Click to activate voice or interrupt"
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        className="transition-transform duration-300 transform group-hover:scale-105"
      />
      {/* Center status pulse label */}
      <div className="absolute flex flex-col items-center pointer-events-none text-center">
        <span className="text-xs uppercase tracking-widest font-mono text-cyan-200/80 font-bold bg-slate-900/60 px-2.5 py-0.5 rounded-full backdrop-blur-md border border-cyan-500/20 shadow-lg">
          {status}
        </span>
      </div>
    </div>
  );
};
