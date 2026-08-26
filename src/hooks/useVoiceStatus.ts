import { useEffect, useState } from 'react';
import { api } from '../api';
import { subscribeEvents } from '../events';
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
    return subscribeEvents((event) => {
      if (event.type === 'voice-state') {
        setVoice((prev) => (prev ? { ...prev, ...event } : prev));
      } else if (event.type === 'bootstrap-progress' && event.status === 'complete') {
        void refresh();
      } else if (event.type === 'benchmark') {
        void refresh();
      }
    }, (message) => setError(message));
  }, []);

  return { voice, refresh, error };
}
