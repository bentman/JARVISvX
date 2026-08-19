import { useEffect, useState } from 'react';
import { api } from '../api';
import { VoiceRuntimeStatus } from '../types';

// Single shared source of "voice status" for every panel that needs it (VoiceHudView,
// VoiceControls/VoiceDiagnostics). Replaces per-panel setInterval polling of GET
// /api/voice (previously 3s in VoiceHudView, 1s in VoiceControls) with one bootstrap
// fetch plus live updates from the existing SSE event stream — this is the concrete
// fix for "three voice-status pollers that can disagree"
// (docs/tech-debt-fragmentation-audit.md, Finding 4).
//
// voice-state SSE events carry a diff (only the fields that changed, plus `state` and
// `message` on every event), so they're merged into the last known snapshot rather
// than replacing it. A few fields (`models`, `tuning`, `voices`) only ever appear in
// the full GET response, so a 'bootstrap-progress' completion or a 'benchmark' event
// triggers one targeted re-fetch instead of trying to reconstruct those from partial
// events.
export function useVoiceStatus() {
  const [voice, setVoice] = useState<VoiceRuntimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const status = await api.voice();
      setVoice(status);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load voice status');
    }
  };

  useEffect(() => {
    void refresh();
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of api.events(controller.signal)) {
          if (event.type === 'voice-state') {
            setVoice((prev) => (prev ? { ...prev, ...event } : prev));
          } else if (event.type === 'bootstrap-progress' && event.status === 'complete') {
            void refresh();
          } else if (event.type === 'benchmark') {
            void refresh();
          }
        }
      } catch (err: any) {
        if (!controller.signal.aborted) setError(err.message || 'Voice event stream disconnected.');
      }
    })();
    return () => controller.abort();
  }, []);

  return { voice, refresh, error };
}
