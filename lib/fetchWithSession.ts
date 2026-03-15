import type { SupabaseClient } from '@supabase/supabase-js';

type JsonResult<T = any> = { response: Response; json: T };

function looksLikeSessionError(json: any) {
  const msg = String(json?.error || '');
  return msg === 'Invalid session' || msg === 'Missing Authorization Bearer token';
}

function mergeHeaders(headers: HeadersInit | undefined, token: string): HeadersInit {
  if (headers instanceof Headers) {
    const next = new Headers(headers);
    next.set('authorization', `Bearer ${token}`);
    return next;
  }
  if (Array.isArray(headers)) {
    const next = new Headers(headers);
    next.set('authorization', `Bearer ${token}`);
    return next;
  }
  return { ...(headers || {}), authorization: `Bearer ${token}` };
}

export async function fetchWithSession<T = any>(
  supabase: SupabaseClient | null,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<JsonResult<T>> {
  if (!supabase) {
    const response = await fetch(input, init);
    const json = await response.json().catch(() => ({} as T));
    return { response, json };
  }

  const session1 = await supabase.auth.getSession();
  let token = session1.data.session?.access_token || '';
  let response = await fetch(input, {
    ...init,
    headers: token ? mergeHeaders(init?.headers, token) : init?.headers,
  });
  let json = await response.json().catch(() => ({} as T));

  if (response.status === 401 && looksLikeSessionError(json)) {
    const refreshed = await supabase.auth.refreshSession();
    token = refreshed.data.session?.access_token || token;
    if (token) {
      response = await fetch(input, {
        ...init,
        headers: mergeHeaders(init?.headers, token),
      });
      json = await response.json().catch(() => ({} as T));
    }
  }

  return { response, json };
}
