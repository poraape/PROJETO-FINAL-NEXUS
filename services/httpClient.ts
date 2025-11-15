import { BFF_TOKEN } from '../config.ts';

type HeadersLike = HeadersInit | undefined;

function ensureAuthHeader(existing?: HeadersInit): HeadersInit {
  if (!BFF_TOKEN) {
    return existing ?? {};
  }
  if (!existing) {
    return { Authorization: `Bearer ${BFF_TOKEN}` };
  }
  if (Array.isArray(existing)) {
    const hasAuth = existing.some(([key]) => key.toLowerCase() === 'authorization');
    return hasAuth ? existing : [...existing, ['Authorization', `Bearer ${BFF_TOKEN}`]];
  }
  if (typeof Headers !== 'undefined' && existing instanceof Headers) {
    if (!existing.has('Authorization')) {
      existing.set('Authorization', `Bearer ${BFF_TOKEN}`);
    }
    return existing;
  }
  const normalized = existing as Record<string, string>;
  const hasKey = Object.keys(normalized).some(key => key.toLowerCase() === 'authorization');
  return hasKey ? existing : { ...normalized, Authorization: `Bearer ${BFF_TOKEN}` };
}

export function withAuthHeaders(existing?: HeadersInit): HeadersInit {
  return ensureAuthHeader(existing);
}

export function authorizedFetch(input: RequestInfo, init: RequestInit = {}) {
  const headers = ensureAuthHeader(init.headers);
  return fetch(input, { ...init, headers });
}
