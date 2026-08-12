const blankTranscriptPattern = /^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise|wooshing(?: sound)?|water splashing|splashing|wind|breathing)[\])]?\.?)*\s*$/i;
const soundEffectPattern = /^\s*[\[(]?[a-z\s-]+(?:sound|noise|music|breathing|wind|splashing)[\])]?\.?\s*$/i;
const wakePrefixPattern = /^\s*(?:hey\s+)?jarvis\b[\s,.:;-]*/i;

export function cleanVoiceTranscript(text) {
  const cleaned = String(text || '').replace(blankTranscriptPattern, '').replace(wakePrefixPattern, '').trim();
  return cleaned && !soundEffectPattern.test(cleaned) ? cleaned : null;
}

