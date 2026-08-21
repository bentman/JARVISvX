import { Brain } from 'lucide-react';

// Native details/summary owns accessible disclosure state. Reasoning text exists only
// for the live message and is absent from persisted conversation history.
export function Thinking({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text) return null;
  return (
    <details className="thinking">
      <summary>
        <Brain style={{ width: 12, height: 12 }} />
        {streaming ? 'Thinking…' : 'Thought process'}
      </summary>
      <p className="thinking-content">{text}</p>
    </details>
  );
}
