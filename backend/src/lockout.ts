// Login brute-force protection stored in Workers KV.
// Per-IP: 5 wrong passcodes → locked 15 min.
// Global: 20 wrong passcodes within an hour (any IP) → all logins locked 1 hour.
// KV is eventually consistent (up to ~60 s), so limits are approximate — good enough for one user.

export const LOCKOUT = {
  ipMaxFails: 5,
  ipLockSec: 15 * 60,
  globalMaxFails: 20,
  globalWindowSec: 3600,
  globalLockSec: 3600,
};

interface IpRecord { fails: number; lockedUntil: number }
interface GlobalRecord { fails: number; windowStart: number; lockedUntil: number }

const ipKey = (ip: string) => `lock:ip:${ip}`;
const GLOBAL_KEY = 'lock:global';
const ttl = (sec: number) => Math.max(60, Math.ceil(sec));

async function readJson<T>(kv: KVNamespace, key: string): Promise<T | null> {
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function lockStatus(kv: KVNamespace, ip: string, nowMs = Date.now()): Promise<{ locked: boolean; retryAfterSec: number }> {
  const now = Math.floor(nowMs / 1000);
  const [ipRec, globalRec] = await Promise.all([
    readJson<IpRecord>(kv, ipKey(ip)),
    readJson<GlobalRecord>(kv, GLOBAL_KEY),
  ]);
  const until = Math.max(ipRec?.lockedUntil ?? 0, globalRec?.lockedUntil ?? 0);
  return until > now ? { locked: true, retryAfterSec: until - now } : { locked: false, retryAfterSec: 0 };
}

export async function recordFailure(kv: KVNamespace, ip: string, nowMs = Date.now()): Promise<void> {
  const now = Math.floor(nowMs / 1000);

  const ipRec = (await readJson<IpRecord>(kv, ipKey(ip))) ?? { fails: 0, lockedUntil: 0 };
  ipRec.fails += 1;
  if (ipRec.fails >= LOCKOUT.ipMaxFails) {
    ipRec.lockedUntil = now + LOCKOUT.ipLockSec;
    ipRec.fails = 0;
  }
  await kv.put(ipKey(ip), JSON.stringify(ipRec), { expirationTtl: ttl(LOCKOUT.ipLockSec * 2) });

  let g = (await readJson<GlobalRecord>(kv, GLOBAL_KEY)) ?? { fails: 0, windowStart: now, lockedUntil: 0 };
  if (now - g.windowStart > LOCKOUT.globalWindowSec) g = { fails: 0, windowStart: now, lockedUntil: g.lockedUntil };
  g.fails += 1;
  if (g.fails >= LOCKOUT.globalMaxFails) {
    g.lockedUntil = now + LOCKOUT.globalLockSec;
    g.fails = 0;
    g.windowStart = now;
  }
  await kv.put(GLOBAL_KEY, JSON.stringify(g), { expirationTtl: ttl(LOCKOUT.globalWindowSec + LOCKOUT.globalLockSec) });
}

export async function recordSuccess(kv: KVNamespace, ip: string): Promise<void> {
  const existing = await kv.get(ipKey(ip));
  if (existing) await kv.delete(ipKey(ip));
}

// ---------- General request rate limit (per isolate, in memory) ----------
// Basic protection for authenticated endpoints. Not shared across Cloudflare locations.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const buckets = new Map<string, { start: number; count: number }>();

export function allowRequest(ip: string, nowMs = Date.now()): boolean {
  const b = buckets.get(ip);
  if (!b || nowMs - b.start >= WINDOW_MS) {
    buckets.set(ip, { start: nowMs, count: 1 });
    if (buckets.size > 1000) buckets.clear();
    return true;
  }
  b.count += 1;
  return b.count <= MAX_PER_WINDOW;
}

export function _resetRateLimit(): void {
  buckets.clear();
}
