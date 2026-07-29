const blankTranscriptPattern = /^\s*(?:[\[(]?(?:blank_audio|blank audio|silence|no speech|music|inaudible|clicking|click|noise)[\])]?\.?)*\s*$/i;
const wakePrefixPattern = /^\s*(?:hey\s+)?jarvis\b[\s,.:;-]*/i;

export function cleanVoiceTranscript(text) {
  const cleaned = String(text || '').replace(blankTranscriptPattern, '').replace(wakePrefixPattern, '').trim();
  return cleaned || null;
}
