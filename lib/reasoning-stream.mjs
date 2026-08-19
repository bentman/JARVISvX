// Some local reasoning models (Phi-4-reasoning, DeepSeek-R1-distill, QwQ, and similar)
// emit their chain-of-thought inline in the raw completion text, wrapped in
// <think>...</think>, rather than as a separate structured field. Left alone, that
// reasoning ends up concatenated into the same string as the actual answer — the
// whole "But caution... but careful..." internal monologue rendered (and logged) as
// if it were the answer.
//
// This splits a token stream into 'content' and 'reasoning' pieces so callers can
// treat them differently: 'content' is the real, loggable answer; 'reasoning' is for
// live display only (a collapsible "thinking" affordance) and is never persisted to
// the conversation log.
//
// Handles the <think>/</think> markers being split across separate stream chunks,
// which happens routinely since provider adapters yield small per-token pieces.

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';

export function createReasoningSplitter() {
  let mode = 'content'; // 'content' | 'reasoning'
  let buffer = '';

  const currentMarker = () => (mode === 'content' ? OPEN_TAG : CLOSE_TAG);

  // Feed one chunk of raw model output; yields { type: 'content'|'reasoning', text }
  // pieces as they become unambiguous (i.e. not possibly the start of a marker).
  function* push(chunk) {
    if (!chunk) return;
    buffer += chunk;
    while (true) {
      const needle = currentMarker();
      const idx = buffer.indexOf(needle);
      if (idx === -1) {
        // Hold back a tail short enough to still be a partial marker — don't emit it
        // yet, in case the rest of the marker arrives in the next chunk.
        const holdBack = needle.length - 1;
        const emitLength = Math.max(0, buffer.length - holdBack);
        if (emitLength > 0) {
          yield { type: mode, text: buffer.slice(0, emitLength) };
          buffer = buffer.slice(emitLength);
        }
        return;
      }
      if (idx > 0) yield { type: mode, text: buffer.slice(0, idx) };
      buffer = buffer.slice(idx + needle.length);
      mode = mode === 'content' ? 'reasoning' : 'content';
    }
  }

  // Call once the stream ends — flushes whatever's left in the buffer (e.g. a
  // reasoning block that never got a closing tag because generation was cut short).
  function* flush() {
    if (buffer) yield { type: mode, text: buffer };
    buffer = '';
  }

  return { push, flush };
}
