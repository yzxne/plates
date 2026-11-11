export type ToastKind = 'ok' | 'error' | 'info';
export interface ToastMsg { id: number; text: string; kind: ToastKind }

type Listener = (t: ToastMsg | null) => void;
const listeners = new Set<Listener>();
let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(text: string, kind: ToastKind = 'info', ms = 3500): void {
  const msg = { id: ++counter, text, kind };
  for (const fn of listeners) fn(msg);
  clearTimeout(timer);
  timer = setTimeout(() => { for (const fn of listeners) fn(null); }, ms);
}

export function subscribeToast(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
