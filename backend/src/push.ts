// Web Push for the rest-timer alert (and later, optional reminders).
// Payload-free pushes: the phone's service worker shows a fixed "Rest done" notification,
// so no message encryption is needed — only a VAPID-signed JWT (ES256 via Web Crypto).
import { b64urlEncode } from './crypto';
import type { Env } from './env';
import { HttpError } from './http';

export const PUSH_SUBJECT = 'https://github.com/yzxne/plates';
const SUBS_KEY = 'push:subs';
const MAX_SUBS = 5;

// Push services Plates will send to (Apple, Google, Mozilla, Microsoft).
const ALLOWED_PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export interface Subscription { endpoint: string; created: string }

export function validEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && ALLOWED_PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export async function listSubs(env: Env): Promise<Subscription[]> {
  try { return JSON.parse((await env.PLATES_KV.get(SUBS_KEY)) ?? '[]') as Subscription[]; } catch { return []; }
}

export async function addSub(env: Env, endpoint: string): Promise<void> {
  const subs = (await listSubs(env)).filter((s) => s.endpoint !== endpoint);
  subs.unshift({ endpoint, created: new Date().toISOString() });
  await env.PLATES_KV.put(SUBS_KEY, JSON.stringify(subs.slice(0, MAX_SUBS)));
}

export async function removeSub(env: Env, endpoint: string): Promise<void> {
  const subs = await listSubs(env);
  const next = subs.filter((s) => s.endpoint !== endpoint);
  if (next.length !== subs.length) await env.PLATES_KV.put(SUBS_KEY, JSON.stringify(next));
}

/** JWT for the push service: ES256, aud = push service origin, 12 h expiry. */
export async function vapidJwt(privateJwk: string, audience: string, nowMs = Date.now()): Promise<string> {
  const enc = new TextEncoder();
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = b64urlEncode(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + 12 * 3600, sub: PUSH_SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwk) as JsonWebKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64urlEncode(new Uint8Array(sig))}`; // Web Crypto returns raw r||s, as JWS ES256 needs
}

function requireVapid(env: Env): { pub: string; priv: string } {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_JWK) {
    throw new HttpError(500, 'push_not_configured', 'Notifications are not set up on the backend yet');
  }
  return { pub: env.VAPID_PUBLIC_KEY, priv: env.VAPID_PRIVATE_JWK };
}

/** Sends an empty push to every subscribed device. Drops subscriptions the push service says are gone. */
export async function sendToAll(env: Env): Promise<{ sent: number; removed: number }> {
  const { pub, priv } = requireVapid(env);
  let sent = 0;
  let removed = 0;
  for (const s of await listSubs(env)) {
    const jwt = await vapidJwt(priv, new URL(s.endpoint).origin);
    const res = await fetch(s.endpoint, {
      method: 'POST',
      headers: { TTL: '120', Urgency: 'high', Authorization: `vapid t=${jwt}, k=${pub}`, 'Content-Length': '0' },
    });
    if (res.status === 404 || res.status === 410) {
      await removeSub(env, s.endpoint);
      removed++;
    } else if (res.ok) {
      sent++;
    } else {
      console.warn('Push failed', res.status, await res.text().catch(() => ''));
    }
  }
  return { sent, removed };
}

// ---------- Scheduling (one Durable Object, one alarm) ----------

/** Holds the single pending rest-timer alarm. SQLite-backed, available on the Workers free plan. */
export class RestTimer {
  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/schedule') {
      const { at } = (await request.json()) as { at: number };
      await this.ctx.storage.setAlarm(at);
      return new Response('ok');
    }
    if (url.pathname === '/cancel') {
      await this.ctx.storage.deleteAlarm();
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    await sendToAll(this.env);
  }
}

export async function scheduleRest(env: Env, seconds: number, nowMs = Date.now()): Promise<number> {
  if (!env.REST_TIMER) throw new HttpError(500, 'push_not_configured', 'Rest timer scheduling is not set up');
  const at = nowMs + Math.round(seconds * 1000);
  const stub = env.REST_TIMER.get(env.REST_TIMER.idFromName('rest'));
  await stub.fetch('https://do/schedule', { method: 'POST', body: JSON.stringify({ at }) });
  return at;
}

export async function cancelRest(env: Env): Promise<void> {
  if (!env.REST_TIMER) return;
  const stub = env.REST_TIMER.get(env.REST_TIMER.idFromName('rest'));
  await stub.fetch('https://do/cancel', { method: 'POST' });
}
