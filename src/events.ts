import { useEffect, useRef } from 'react';
import { api } from './api';

// One daemon event stream serves the whole renderer. Consumers register a
// handler instead of opening their own connection, so the number of SSE
// subscriptions does not grow with the number of mounted views.

type Listener = { onEvent: (event: any) => void; onError?: (message: string) => void };

const listeners = new Set<Listener>();
let controller: AbortController | null = null;

function open() {
  const active = new AbortController();
  controller = active;
  void (async () => {
    try {
      for await (const event of api.events(active.signal)) {
        for (const listener of [...listeners]) listener.onEvent(event);
      }
    } catch (error: any) {
      if (active.signal.aborted) return;
      const message = error?.message || 'Assistant event stream disconnected.';
      for (const listener of [...listeners]) listener.onError?.(message);
    }
  })();
}

export function subscribeEvents(onEvent: Listener['onEvent'], onError?: Listener['onError']) {
  const listener: Listener = { onEvent, onError };
  listeners.add(listener);
  if (!controller) open();
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    controller?.abort();
    controller = null;
  };
}

// Handlers are read through refs so a consumer re-rendering does not tear the
// shared stream down and rebuild it.
export function useDaemonEvents(onEvent: Listener['onEvent'], onError?: Listener['onError']) {
  const eventRef = useRef(onEvent);
  const errorRef = useRef(onError);
  eventRef.current = onEvent;
  errorRef.current = onError;
  useEffect(() => subscribeEvents((event) => eventRef.current(event), (message) => errorRef.current?.(message)), []);
}
