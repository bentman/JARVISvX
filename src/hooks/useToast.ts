import { useCallback, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'error';
export interface Toast { id: number; variant: ToastVariant; message: string; }

export function useToast(defaultDurationMs = 2500) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((message: string, variant: ToastVariant = 'success', durationMs = defaultDurationMs) => {
    setToasts((items) => {
      const last = items[items.length - 1];
      // Repeated identical messages share one toast and refresh its timer.
      if (last && last.variant === variant && last.message === message) {
        const timer = timers.current.get(last.id);
        if (timer) clearTimeout(timer);
        if (durationMs > 0) timers.current.set(last.id, setTimeout(() => dismiss(last.id), durationMs));
        return items;
      }
      const id = nextId.current++;
      if (durationMs > 0) timers.current.set(id, setTimeout(() => dismiss(id), durationMs));
      return [...items, { id, variant, message }];
    });
  }, [defaultDurationMs, dismiss]);

  const success = useCallback((message: string, durationMs?: number) => show(message, 'success', durationMs), [show]);
  const error = useCallback((message: string, durationMs?: number) => show(message, 'error', durationMs), [show]);

  return { toasts, show, success, error, dismiss };
}
