import { describe, expect, it } from 'vitest';
import { RetryQueue, type PendingWrite } from '../src/retryQueue';
import type { StoreLike } from '../src/storage';
import { mergeSettingsBodies } from '../src/queue';

class MapStore implements StoreLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

class BrokenStore implements StoreLike {
  getItem(): string | null { throw new Error('blocked'); }
  setItem(): void { throw new Error('blocked'); }
  removeItem(): void { throw new Error('blocked'); }
}

class HttpLikeError extends Error {
  constructor(public status: number) { super(`status ${status}`); }
}
const retryable = (e: unknown) => !(e instanceof HttpLikeError) || e.status >= 500 || e.status === 409 || e.status === 0;

const write = (label: string, body: unknown = {}) => ({ method: 'PUT' as const, path: '/x', body, label, error: 'offline' });

describe('RetryQueue', () => {
  it('keeps failed writes across app restarts', () => {
    const store = new MapStore();
    new RetryQueue(store, async () => {}, retryable).add(write('A'));
    const reopened = new RetryQueue(store, async () => {}, retryable);
    expect(reopened.list().map((i) => i.label)).toEqual(['A']);
  });

  it('sends in order and removes successes', async () => {
    const sent: string[] = [];
    const q = new RetryQueue(new MapStore(), async (w) => { sent.push(w.label); }, retryable);
    q.add(write('A'));
    q.add(write('B'));
    expect(await q.flush()).toEqual({ sent: 2, failed: 0 });
    expect(sent).toEqual(['A', 'B']);
    expect(q.list()).toEqual([]);
  });

  it('stops at a retryable failure and keeps everything', async () => {
    const q = new RetryQueue(new MapStore(), async () => { throw new HttpLikeError(0); }, retryable);
    q.add(write('A'));
    q.add(write('B'));
    expect(await q.flush()).toEqual({ sent: 0, failed: 1 });
    expect(q.list().map((i) => [i.label, i.attempts, i.stuck])).toEqual([['A', 2, false], ['B', 1, false]]);
  });

  it('marks rejected writes as stuck but never drops them', async () => {
    const q = new RetryQueue(new MapStore(), async (w: PendingWrite) => {
      if (w.label === 'bad') throw new HttpLikeError(400);
    }, retryable);
    q.add(write('bad'));
    q.add(write('good'));
    const r = await q.flush();
    expect(r).toEqual({ sent: 1, failed: 1 });
    expect(q.list()).toHaveLength(1);
    expect(q.list()[0]!.stuck).toBe(true);
    q.discard(q.list()[0]!.id);
    expect(q.list()).toEqual([]);
  });

  it('coalesces repeated settings saves, newest values win', () => {
    const q = new RetryQueue(new MapStore(), async () => {}, retryable);
    q.add({ ...write('Settings', { settings: { a: '1', b: '1' } }), coalesceKey: 'settings' }, mergeSettingsBodies);
    q.add({ ...write('Settings', { settings: { b: '2', c: '2' } }), coalesceKey: 'settings' }, mergeSettingsBodies);
    expect(q.list()).toHaveLength(1);
    expect(q.list()[0]!.body).toEqual({ settings: { a: '1', b: '2', c: '2' } });
  });

  it('still works in memory when storage is blocked', async () => {
    const sent: string[] = [];
    const q = new RetryQueue(new BrokenStore(), async (w) => { sent.push(w.label); }, retryable);
    q.add(write('A'));
    expect(q.list()).toHaveLength(1);
    await q.flush();
    expect(sent).toEqual(['A']);
  });

  it('notifies subscribers', () => {
    const q = new RetryQueue(new MapStore(), async () => {}, retryable);
    let calls = 0;
    const unsub = q.subscribe(() => calls++);
    q.add(write('A'));
    unsub();
    q.add(write('B'));
    expect(calls).toBe(1);
  });
});
