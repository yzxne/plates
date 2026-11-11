export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const BASE_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(err: HttpError): Response {
  return json({ error: err.code, message: err.message, ...err.extra }, err.status);
}

export function parseOrigins(list: string | undefined): string[] {
  return (list ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const MAX_BODY_BYTES = 1_000_000;

export async function readJson<T = Record<string, unknown>>(request: Request, maxBytes = MAX_BODY_BYTES): Promise<T> {
  const len = Number(request.headers.get('Content-Length') ?? '0');
  if (len > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large');
  if (!text) return {} as T;
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data as T;
  } catch {
    throw new HttpError(400, 'bad_json', 'Body must be a JSON object');
  }
}
