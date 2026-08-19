import { Zap } from 'lucide-react';
import type { ToolCallActivity } from '../types';

// Compact, live list of tool calls made during one assistant turn (see the
// 'tool-call'/'tool-result' SSE events handled in App.tsx's send()). Same
// treatment as Thinking.tsx: in-memory only, not part of the persisted
// transcript — a resumed conversation won't show past tool activity.
export function ToolActivity({ calls }: { calls?: ToolCallActivity[] }) {
  if (!calls?.length) return null;
  return (
    <div className="tool-activity">
      {calls.map((call, index) => (
        <div className="tool-activity-item" key={`${call.name}-${index}`}>
          <Zap style={{ width: 12, height: 12 }} />
          <span>{call.status === 'running' ? `Running ${call.name}…` : `${call.name} → ${(call.output || '').slice(0, 200)}`}</span>
        </div>
      ))}
    </div>
  );
}
