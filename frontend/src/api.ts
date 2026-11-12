import { safeStore } from './storage';

export const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8787').replace(/\/$/, '');

const TOKEN_KEY = 'plates.session';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
  /** True when retrying later might work (offline, timeouts, server/Google hiccups, not connected yet). */
  get retryable(): boolean {
    return this.status === 0 || this.status === 401 || this.status === 408 || this.status === 409 || this.status === 429 || this.status >= 500;
  }
}

export const getToken = () => safeStore.getItem(TOKEN_KEY);
export const setToken = (t: string) => safeStore.setItem(TOKEN_KEY, t);
export const clearToken = () => safeStore.removeItem(TOKEN_KEY);

let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: () => void): void {
  unauthorizedHandler = fn;
}

export async function api<T = unknown>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new ApiError(0, 'network', ctrl.signal.aborted ? 'The server took too long to answer' : "Can't reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
  }

  let data: any = null;
  try { data = await res.json(); } catch { /* empty or non-JSON */ }

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      clearToken();
      unauthorizedHandler?.();
    }
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Request failed (${res.status})`, data ?? {});
  }
  return data as T;
}

/** GET that returns a file (e.g. a backup) instead of JSON. */
export async function apiBlob(path: string, timeoutMs = 60_000): Promise<Blob> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(API_BASE + path, { headers: { Authorization: `Bearer ${getToken() ?? ''}` }, signal: ctrl.signal });
    if (!res.ok) {
      let data: any = null;
      try { data = await res.json(); } catch { /* not JSON */ }
      throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `Download failed (${res.status})`);
    }
    return await res.blob();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, 'network', "Can't reach the server. Check your connection.");
  } finally {
    clearTimeout(timer);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
