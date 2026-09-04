// Auto-summarize applies keyword matching to recent user messages and stores matching
// preference or configuration statements verbatim without invoking a provider.
const FACT_EXTRACTION_PATTERN = /prefer|always|never|favorite|config|setup|project/i;

export function extractMemoryFactsByRegex(db) {
  const conversations = db.conversations() || [];
  let addedCount = 0;

  for (const conv of conversations.slice(0, 5)) {
    const msgs = db.messages(conv.id) || [];
    for (const msg of msgs) {
      if (msg.role === 'user' && msg.content) {
        const text = msg.content.trim();
        if (FACT_EXTRACTION_PATTERN.test(text) && text.length > 15) {
          const key = `Auto Fact: ${text.slice(0, 30)}...`;
          const existing = db.searchMemories(text.slice(0, 20));
          if (!existing.length) {
            db.addMemory({
              category: 'conversation_summary',
              key,
              value: text,
              importance: 'medium'
            });
            addedCount++;
          }
        }
      }
    }
  }

  return {
    addedCount,
    totalMemories: (db.memories() || []).length
  };
}

// Selection is bounded so a growing memory store cannot grow the prompt without
// limit. Ordering is importance, then recency, then record ID, so the same store
// always produces the same section.
export const MEMORY_CHARACTER_BUDGET = 2000;

const IMPORTANCE_RANK = { high: 0, medium: 1, low: 2 };
const MEMORY_LINE_CACHE = new WeakMap();

const renderMemory = (memory) => {
  if (!memory || typeof memory !== 'object') return null;
  const cached = MEMORY_LINE_CACHE.get(memory);
  if (cached !== undefined) return cached;
  const key = String(memory.key ?? '').trim();
  const value = String(memory.value ?? '').trim();
  if (!key || !value) {
    MEMORY_LINE_CACHE.set(memory, null);
    return null;
  }
  const line = `- [${String(memory.category ?? 'general').toUpperCase()}] ${key}: ${value}`;
  MEMORY_LINE_CACHE.set(memory, line);
  return line;
};

/**
 * Choose the memories that fit the budget, newest and most important first.
 *
 * The returned metadata says which records were taken, which the budget left
 * out, and which could not be rendered. It exists so selection is testable and
 * is not part of the prompt or of anything an operator sees.
 */
export function selectMemories(db, { budget = MEMORY_CHARACTER_BUDGET } = {}) {
  const ordered = [...(db.memories() || [])].sort((a, b) => {
    const rank = (IMPORTANCE_RANK[a.importance] ?? 1) - (IMPORTANCE_RANK[b.importance] ?? 1);
    if (rank) return rank;
    const bTime = String(b.updated_at || '');
    const aTime = String(a.updated_at || '');
    if (bTime !== aTime) return bTime > aTime ? 1 : -1;
    const aId = String(a.id);
    const bId = String(b.id);
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  const lines = [];
  const selected = [];
  const excluded = [];
  const skipped = [];
  let used = 0;

  for (const memory of ordered) {
    const line = renderMemory(memory);
    if (!line) { skipped.push(memory.id); continue; }
    if (used + line.length + 1 > budget) { excluded.push(memory.id); continue; }
    lines.push(line);
    selected.push(memory.id);
    used += line.length + 1;
  }

  return { text: lines.join('\n'), selected, excluded, skipped, budget, used };
}
