import type { Env } from './env';
import { decryptString, encryptString } from './crypto';
import { HttpError } from './http';

export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const KV_KEYS = {
  refresh: 'google:refresh',
  access: 'google:access',
  reconnect: 'google:reconnect_needed',
  spreadsheetId: 'google:spreadsheet_id',
} as const;

interface CachedAccess { token: string; exp: number } // exp in ms
let memAccess: CachedAccess | null = null;

export function _resetGoogleCache(): void {
  memAccess = null;
}

function requireConfig(env: Env): { clientId: string; clientSecret: string; encKey: string } {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(500, 'google_not_configured', 'Google client ID/secret are not set on the backend');
  }
  if (!env.TOKEN_ENC_KEY) throw new HttpError(500, 'not_configured', 'TOKEN_ENC_KEY is not set on the backend');
  return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, encKey: env.TOKEN_ENC_KEY };
}

export function redirectUri(requestUrl: string): string {
  return new URL('/oauth/google/callback', requestUrl).toString();
}

export function buildAuthUrl(env: Env, redirect: string, state: string): string {
  const { clientId } = requireConfig(env);
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: 'code',
    scope: GOOGLE_SCOPE,
    access_type: 'offline', // ask for a refresh token
    prompt: 'consent', // always return a refresh token, even on reconnect
    state,
  });
  return `${AUTH_URL}?${p.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function postToken(body: Record<string, string>): Promise<{ status: number; data: TokenResponse }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  let data: TokenResponse = {};
  try { data = (await res.json()) as TokenResponse; } catch { /* non-JSON error */ }
  return { status: res.status, data };
}

async function cacheAccess(env: Env, encKey: string, token: string, expiresInSec: number, nowMs: number): Promise<string> {
  const exp = nowMs + expiresInSec * 1000;
  memAccess = { token, exp };
  // ~1 write per hour at most; KV free tier allows 1,000/day.
  await env.PLATES_KV.put(KV_KEYS.access, await encryptString(encKey, JSON.stringify(memAccess)), {
    expirationTtl: Math.max(60, expiresInSec - 60),
  });
  return token;
}

/** Exchanges the OAuth code, stores the refresh token encrypted in KV. */
export async function exchangeCode(env: Env, code: string, redirect: string, nowMs = Date.now()): Promise<void> {
  const { clientId, clientSecret, encKey } = requireConfig(env);
  const { status, data } = await postToken({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });
  if (status !== 200 || !data.access_token) {
    throw new HttpError(502, 'google_token_error', `Google sign-in failed: ${data.error_description ?? data.error ?? status}`);
  }
  const scopes = (data.scope ?? '').split(' ');
  if (!scopes.includes(GOOGLE_SCOPE)) {
    throw new HttpError(400, 'google_scope_missing', 'Google access to Plates files was not granted. Tick the Drive box on the consent screen.');
  }
  if (!data.refresh_token) {
    throw new HttpError(502, 'google_no_refresh', 'Google did not return a refresh token. Remove Plates under Google Account → Security → Third-party access, then connect again.');
  }
  await env.PLATES_KV.put(KV_KEYS.refresh, await encryptString(encKey, data.refresh_token));
  await env.PLATES_KV.delete(KV_KEYS.reconnect);
  await cacheAccess(env, encKey, data.access_token, data.expires_in ?? 3600, nowMs);
}

/** Returns a valid access token, refreshing it when needed. */
export async function getAccessToken(env: Env, nowMs = Date.now()): Promise<string> {
  if (memAccess && memAccess.exp - 60_000 > nowMs) return memAccess.token;
  const { clientId, clientSecret, encKey } = requireConfig(env);

  const cached = await env.PLATES_KV.get(KV_KEYS.access);
  if (cached) {
    try {
      const c = JSON.parse(await decryptString(encKey, cached)) as CachedAccess;
      if (c.exp - 60_000 > nowMs) {
        memAccess = c;
        return c.token;
      }
    } catch { /* ignore stale/corrupt cache */ }
  }

  const encRefresh = await env.PLATES_KV.get(KV_KEYS.refresh);
  if (!encRefresh) throw new HttpError(409, 'google_not_connected', 'Google is not connected');
  const refreshToken = await decryptString(encKey, encRefresh);

  const { status, data } = await postToken({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });
  if (status === 400 && data.error === 'invalid_grant') {
    await env.PLATES_KV.put(KV_KEYS.reconnect, '1');
    memAccess = null;
    throw new HttpError(409, 'google_reconnect', 'Google access expired or was revoked. Reconnect Google in More → Settings.');
  }
  if (status !== 200 || !data.access_token) {
    throw new HttpError(502, 'google_token_error', `Could not refresh Google access: ${data.error_description ?? data.error ?? status}`);
  }
  return cacheAccess(env, encKey, data.access_token, data.expires_in ?? 3600, nowMs);
}

export async function googleConnection(env: Env): Promise<{ connected: boolean; reconnectNeeded: boolean }> {
  const [refresh, reconnect] = await Promise.all([
    env.PLATES_KV.get(KV_KEYS.refresh),
    env.PLATES_KV.get(KV_KEYS.reconnect),
  ]);
  return { connected: !!refresh && !reconnect, reconnectNeeded: !!reconnect };
}

/** Revokes Google access (best effort) and forgets tokens. Keeps the spreadsheet ID. */
export async function disconnectGoogle(env: Env): Promise<void> {
  const encRefresh = await env.PLATES_KV.get(KV_KEYS.refresh);
  if (encRefresh && env.TOKEN_ENC_KEY) {
    try {
      const token = await decryptString(env.TOKEN_ENC_KEY, encRefresh);
      await fetch(REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
    } catch { /* revoke is best effort */ }
  }
  await Promise.all([
    env.PLATES_KV.delete(KV_KEYS.refresh),
    env.PLATES_KV.delete(KV_KEYS.access),
    env.PLATES_KV.delete(KV_KEYS.reconnect),
  ]);
  memAccess = null;
}
