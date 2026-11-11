// Writes that failed are kept here (and in localStorage) until they succeed or you discard them.
// Nothing is dropped automatically.

import type { StoreLike } from './storage';

export interface PendingWrite {
  id: string;
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  label: string;
  coalesceKey?: string;
  attempts: number;
  lastError: string;
  stuck: boolean; // server rejected it (needs you to fix or discard)
  createdAt: string;
}

export interface NewWrite {
  method: 'POST' | 'PUT';
  path: string;
  body: unknown;
  label: string;
  coalesceKey?: string;
  error: string;
}

export type Sender = (w: PendingWrite) => Promise<void>;
export type IsRetryable = (err: unknown) => boolean;

const KEY = 'plates.pending.v1';

export class RetryQueue {
  private items: PendingWrite[];
  private listeners = new Set<() => void>();
  private flushing: Promise<{ sent: number; failed: number }> | null = null;

  constructor(private store: StoreLike, private send: Sender, private isRetryable: IsRetryable, private key = KEY) {
    this.items = this.load();
  }

  private load(): PendingWrite[] {
    try {
      const raw = this.store.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try { this.store.setItem(this.key, JSON.stringify(this.items)); } catch { /* still in memory */ }
    for (const fn of this.listeners) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  list(): PendingWrite[] {
    return [...this.items];
  }

  find(coalesceKey: string): PendingWrite | undefined {
    return this.items.find((i) => i.coalesceKey === coalesceKey);
  }

  /** Adds a failed write. With a coalesceKey, `merge` combines it with an older pending write of the same kind. */
  add(w: NewWrite, merge?: (olderBody: unknown, newerBody: unknown) => unknown): PendingWrite {
    const existing = w.coalesceKey ? this.find(w.coalesceKey) : undefined;
    if (existing) {
      existing.body = merge ? merge(existing.body, w.body) : w.body;
      existing.lastError = w.error;
      existing.stuck = false;
      this.save();
      return existing;
    }
    const item: PendingWrite = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      method: w.method,
      path: w.path,
      body: w.body,
      label: w.label,
      coalesceKey: w.coalesceKey,
      attempts: 1,
      lastError: w.error,
      stuck: false,
      createdAt: new Date().toISOString(),
    };
    this.items.push(item);
    this.save();
    return item;
  }

  discard(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.save();
  }

  /** Sends pending writes in order. Stops at the first retryable failure (e.g. still offline). */
  flush(): Promise<{ sent: number; failed: number }> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      let sent = 0;
      let failed = 0;
      for (const item of [...this.items]) {
        if (item.stuck) continue;
        try {
          await this.send(item);
          this.items = this.items.filter((i) => i.id !== item.id);
          sent++;
          this.save();
        } catch (err) {
          item.attempts++;
          item.lastError = err instanceof Error ? err.message : String(err);
          failed++;
          if (this.isRetryable(err)) {
            this.save();
            break;
          }
          item.stuck = true;
          this.save();
        }
      }
      return { sent, failed };
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
}
