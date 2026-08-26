// VoiceHost owns the only microphone stream; views that display input level read
// it from here instead of opening a second capture of their own.

let level = 0;

export function publishAudioLevel(next: number) { level = next; }
export function currentAudioLevel() { return level; }
