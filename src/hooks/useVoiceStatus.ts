import { useEffect, useState } from 'react';
import { api } from '../api';
import { VoiceRuntimeStatus } from '../types';

// Voice-state events are partial updates and merge into the bootstrap snapshot.
// Bootstrap completion and benchmark events trigger a full refresh for fields that
// are absent from voice-state events, including models, tuning, and voices.
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
