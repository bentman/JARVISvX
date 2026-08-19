import { useCallback, useRef, useState } from 'react';

export type ToastVariant = 'success' | 'error';
export interface Toast { id: number; variant: ToastVariant; message: string; }

// Shared "it saved" / "it failed" feedback — replaces three independent
// savedSuccess/actionSuccess + setTimeout reimplementations and WorkspacesPanel's
// blocking native alert() calls (docs/tech-debt-fragmentation-audit.md, Finding 5).
// alert() in particular is a real functional problem, not just style: it's a
// synchronous, blocking browser dialog that halts the whole page (and, in Electron,
// can block the renderer process) until dismissed — every other panel already gives
// feedback without blocking anything.
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
      // A caller that fires the same message repeatedly in quick succession (e.g. a
      // range input's onChange, which fires per pixel while dragging) should refresh
      // one toast's timer, not pile up a duplicate per tick.
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
