/**
 * Minimal API client for illtip-backend (mirrors illtip-mobile/src/config/axios.ts):
 * - attaches the Bearer access token
 * - on 401 (except public auth routes) exchanges the refresh token at /auth/v2/refresh once and retries
 * - axios-like helpers: api.get/post/put/patch/delete returning { data, status }
 */
import { API_BASE_URL } from './env';

export type Session = {
  user: { id: string; email: string; name: string; emailVerified?: boolean; roleSelected?: boolean; imageUrl?: string; phone?: string };
  accessToken: string;
  refreshToken: string;
};

const KEY = 'illtip.session';
let session: Session | null = null;
const listeners = new Set<(s: Session | null) => void>();

export function loadSession(): Session | null {
  if (session) return session;
  try {
    const raw = localStorage.getItem(KEY);
    session = raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    session = null;
  }
  return session;
}

export function saveSession(s: Session | null) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(s));
}

export function onSession(fn: (s: Session | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const PUBLIC_AUTH = /\/auth\/(v2\/(login|register|forgot-password|verify-password-reset-code|reset-password)|generateotp|validateotp)/i;

let refreshing: Promise<string | null> | null = null;

async function refreshToken(): Promise<string | null> {
  const s = loadSession();
  if (!s?.refreshToken) return null;
  try {
    const r = await fetch(`${API_BASE_URL}/auth/v2/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken: s.refreshToken }),
    });
    const d = await r.json().catch(() => ({}));
    const at = d?.accessToken ?? d?.data?.accessToken;
    if (!r.ok || !at) return null;
    const rt = d?.refreshToken ?? d?.data?.refreshToken ?? s.refreshToken;
    saveSession({ ...s, accessToken: at, refreshToken: rt });
    return at;
  } catch {
    return null;
  }
}

type Opts = { params?: Record<string, any>; headers?: Record<string, string>; signal?: AbortSignal; raw?: boolean };

function buildUrl(path: string, params?: Record<string, any>) {
  const url = /^https?:/.test(path) ? new URL(path) : new URL(API_BASE_URL + (path.startsWith('/') ? path : '/' + path));
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  return url.toString();
}

async function request<T = any>(method: string, path: string, body?: any, opts: Opts = {}, retried = false): Promise<{ data: T; status: number }> {
  const s = loadSession();
  const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*', ...(opts.headers || {}) };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (s?.accessToken) headers.Authorization = `Bearer ${s.accessToken}`;
  const res = await fetch(buildUrl(path, opts.params), {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    signal: opts.signal,
  });
  if (res.status === 401 && !retried && !PUBLIC_AUTH.test(path) && s?.refreshToken) {
    refreshing = refreshing || refreshToken().finally(() => (refreshing = null));
    const at = await refreshing;
    if (at) return request<T>(method, path, body, opts, true);
    saveSession(null);
  }
  const text = await res.text();
  let data: any = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `Request failed (${res.status})`;
    throw new ApiError(String(msg), res.status, data);
  }
  return { data: data as T, status: res.status };
}

export const api = {
  get: <T = any>(path: string, opts?: Opts) => request<T>('GET', path, undefined, opts),
  post: <T = any>(path: string, body?: any, opts?: Opts) => request<T>('POST', path, body ?? {}, opts),
  put: <T = any>(path: string, body?: any, opts?: Opts) => request<T>('PUT', path, body ?? {}, opts),
  patch: <T = any>(path: string, body?: any, opts?: Opts) => request<T>('PATCH', path, body ?? {}, opts),
  delete: <T = any>(path: string, body?: any, opts?: Opts) => request<T>('DELETE', path, body, opts),
};

/** Most v2 endpoints answer { success, message, data }. Returns data, or throws with the backend message. */
export function unwrap<T = any>(res: { data: any }): T {
  const d = res.data;
  if (d && typeof d === 'object' && 'success' in d && d.success === false) throw new ApiError(d.message || 'Request failed', 200, d);
  return (d && typeof d === 'object' && 'data' in d ? d.data : d) as T;
}
