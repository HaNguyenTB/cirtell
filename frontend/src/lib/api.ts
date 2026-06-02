import { getToken, clearToken } from './authToken';
import { useAuthStore } from '../stores/authStore';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8787';

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  redirectOnUnauthorized?: boolean;
  authToken?: string | null;
}

interface ErrorResponse {
  message?: string;
  error?: string;
}

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, redirectOnUnauthorized = true, authToken } = opts;
  const token = authToken ?? getToken();
  const authState = useAuthStore.getState();

  let url = `${API_URL}${path}`;
  const scopedParams: Record<string, string | number | undefined> = { ...(params || {}) };
  const shouldAttachScope = path.startsWith('/api/')
    && !path.startsWith('/api/auth')
    && !path.startsWith('/api/admin');
  if (shouldAttachScope) {
    if (authState.currentCompanyId && authState.currentCompanyId !== '__ALL__') {
      scopedParams.company_id ??= authState.currentCompanyId;
    } else if (authState.selectedTenantId) {
      scopedParams.tenant_id ??= authState.selectedTenantId;
    }
  }

  if (Object.keys(scopedParams).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(scopedParams)) {
      if (value !== undefined && value !== '') {
        searchParams.set(key, String(value));
      }
    }
    const qs = searchParams.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  const isFormData = body instanceof FormData;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (body && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    credentials: 'include',
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
