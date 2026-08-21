// Local models may embed reasoning in <think> tags. The splitter emits persisted
// content separately from request-local reasoning and retains partial tags across chunks.

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
