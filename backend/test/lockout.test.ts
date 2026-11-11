import { beforeEach, describe, expect, it } from 'vitest';
import { _resetRateLimit, allowRequest, LOCKOUT, lockStatus, recordFailure, recordSuccess } from '../src/lockout';
import { MemoryKV } from './helpers';

const kv = () => new MemoryKV() as unknown as KVNamespace;

describe('login lockout', () => {
  it('locks an IP after 5 failures for 15 minutes', async () => {
    const store = kv();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < LOCKOUT.ipMaxFails - 1; i++) await recordFailure(store, 'a', t0);
    expect((await lockStatus(store, 'a', t0)).locked).toBe(false);
    await recordFailure(store, 'a', t0);
    const s = await lockStatus(store, 'a', t0);
    expect(s.locked).toBe(true);
    expect(s.retryAfterSec).toBe(LOCKOUT.ipLockSec);
    expect((await lockStatus(store, 'b', t0)).locked).toBe(false);
    expect((await lockStatus(store, 'a', t0 + LOCKOUT.ipLockSec * 1000 + 1000)).locked).toBe(false);
  });

  it('success clears the IP counter', async () => {
    const store = kv();
    for (let i = 0; i < 4; i++) await recordFailure(store, 'a');
    await recordSuccess(store, 'a');
    await recordFailure(store, 'a');
    expect((await lockStatus(store, 'a')).locked).toBe(false);
  });

  it('locks everyone after 20 failures across IPs within an hour', async () => {
    const store = kv();
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < LOCKOUT.globalMaxFails; i++) await recordFailure(store, `ip${i}`, t0);
    expect((await lockStatus(store, 'fresh-ip', t0)).locked).toBe(true);
  });
});

describe('request rate limit', () => {
  beforeEach(() => _resetRateLimit());
  it('allows 120 requests per minute per IP', () => {
    const t = 1_000_000;
    for (let i = 0; i < 120; i++) expect(allowRequest('x', t)).toBe(true);
    expect(allowRequest('x', t)).toBe(false);
    expect(allowRequest('y', t)).toBe(true);
    expect(allowRequest('x', t + 60_000)).toBe(true);
  });
});
