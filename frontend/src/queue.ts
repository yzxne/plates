import { api, ApiError } from './api';
import { RetryQueue } from './retryQueue';
import { safeStore } from './storage';

export const queue = new RetryQueue(
  safeStore,
  async (w) => { await api(w.method, w.path, w.body); },
  (err) => !(err instanceof ApiError) || err.retryable,
);

/** Merge for queued settings saves: newer values win, older unsent ones are kept. */
export function mergeSettingsBodies(older: unknown, newer: unknown): unknown {
  const o = (older as { settings?: Record<string, string> })?.settings ?? {};
  const n = (newer as { settings?: Record<string, string> })?.settings ?? {};
  return { settings: { ...o, ...n } };
}
