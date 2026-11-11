// One Undo banner at a time ("Logged Banana · Undo · Edit"). Replaces confirm screens (brief v2 §5).
export interface UndoMsg {
  id: number;
  text: string;
  undo?: () => void | Promise<void>;
  edit?: () => void;
}

type Listener = (m: UndoMsg | null) => void;
const listeners = new Set<Listener>();
let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function showUndo(text: string, opts: { undo?: UndoMsg['undo']; edit?: UndoMsg['edit']; ms?: number } = {}): void {
  const msg: UndoMsg = { id: ++counter, text, undo: opts.undo, edit: opts.edit };
  for (const fn of listeners) fn(msg);
  clearTimeout(timer);
  timer = setTimeout(() => hideUndo(), opts.ms ?? 6000);
}

export function hideUndo(): void {
  clearTimeout(timer);
  for (const fn of listeners) fn(null);
}

export function subscribeUndo(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
