import { Zap } from 'lucide-react';
import type { ToolCallActivity } from '../types';

// Tool-call events are live message state and are absent from persisted history.
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
