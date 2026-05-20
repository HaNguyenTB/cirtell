import { getToken, clearToken } from './authToken';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  redirectOnUnauthorized?: boolean;
}

interface ErrorResponse {
  message?: string;
  error?: string;
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, redirectOnUnauthorized = true } = opts;
  const token = getToken();

  let url = `${API_URL}${path}`;
  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    clearToken();
    if (redirectOnUnauthorized) {
      window.location.href = '/login';
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const err = await res.json().catch((): ErrorResponse => ({ error: res.statusText })) as ErrorResponse;
    throw new Error(err.message || err.error || `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}
