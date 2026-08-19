import { Brain } from 'lucide-react';

// Collapsible "chain of thought" twisty for reasoning-model output. Uses the native
// <details>/<summary> element rather than another bespoke expand/collapse component —
// it's accessible and stateful for free, and doesn't add to the app's existing pile of
// hand-rolled disclosure widgets (see the fragmentation audit's ui-kit-drift finding).
//
// `text` is the live 'reasoning' SSE stream for this message, held only in memory —
// it is never sent back to the server and never appears in conversation history after
// a reload, by design: viewable while it's happening, not part of the logged answer.
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
