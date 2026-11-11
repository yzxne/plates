import { b64urlDecode, b64urlEncode, hmacSign, hmacVerify, randomBytes } from './crypto';

export type TokenType = 'session' | 'oauth_state';

export interface TokenPayload {
  typ: TokenType;
  iat: number; // seconds
  exp: number; // seconds
  nonce: string;
}

export const SESSION_TTL_SEC = 30 * 24 * 3600; // 30 days
export const STATE_TTL_SEC = 10 * 60; // 10 minutes

const enc = new TextEncoder();
const dec = new TextDecoder();

export async function signToken(secret: string, typ: TokenType, ttlSec: number, nowMs = Date.now()): Promise<{ token: string; exp: number }> {
  const iat = Math.floor(nowMs / 1000);
  const payload: TokenPayload = { typ, iat, exp: iat + ttlSec, nonce: b64urlEncode(randomBytes(12)) };
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSign(secret, `${typ}.${body}`);
  return { token: `${body}.${sig}`, exp: payload.exp };
}

export async function verifyToken(secret: string, token: string, typ: TokenType, nowMs = Date.now()): Promise<TokenPayload | null> {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  if (!(await hmacVerify(secret, `${typ}.${body}`, sig))) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(body)));
  } catch {
    return null;
  }
  if (payload.typ !== typ) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(nowMs / 1000)) return null;
  return payload;
}

export function bearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1]!.trim() : null;
}
