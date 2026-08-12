export function autoSummarizeConversations(db) {
  const conversations = db.conversations() || [];
  let addedCount = 0;

  for (const conv of conversations.slice(0, 5)) {
    const msgs = db.messages(conv.id) || [];
    for (const msg of msgs) {
      if (msg.role === 'user' && msg.content) {
        const text = msg.content.trim();
        if (/prefer|always|never|favorite|config|setup|project/i.test(text) && text.length > 15) {
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

export function formatMemoriesContext(db) {
  const memories = db.memories() || [];
  const topMemories = memories.slice(0, 10);
  if (!topMemories.length) return '';

  const lines = topMemories.map((m) => `- [${m.category.toUpperCase()}] ${m.key}: ${m.value}`);
  return `\n\nLONG-TERM MEMORY CONTEXT:\n${lines.join('\n')}`;
}

