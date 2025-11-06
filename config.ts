// config.ts

/**
 * URL base para o servidor Backend-for-Frontend (BFF).
 * Todas as chamadas de API do frontend devem ser direcionadas para este servidor.
 */
const DEFAULT_BACKEND_PORT = parseInt(import.meta.env?.VITE_BFF_PORT || '3001', 10);

function resolveBackendHost(windowHost: string): string {
  if (windowHost.includes('app.github.dev')) {
    const parts = windowHost.split('.');
    const subdomainParts = parts[0].split('-');
    const lastSegment = subdomainParts[subdomainParts.length - 1];
    if (/^\d+$/.test(lastSegment)) {
      subdomainParts[subdomainParts.length - 1] = DEFAULT_BACKEND_PORT.toString();
      parts[0] = subdomainParts.join('-');
      return parts.join('.');
    }
    return `${parts[0]}-${DEFAULT_BACKEND_PORT}.${parts.slice(1).join('.')}`;
  }

  if (windowHost.includes(':')) {
    return windowHost.replace(/:\d+$/, `:${DEFAULT_BACKEND_PORT}`);
  }

  return `${windowHost}:${DEFAULT_BACKEND_PORT}`;
}

function deriveBackendConfig() {
  if (typeof window === 'undefined') {
    const origin = import.meta.env?.VITE_BFF_API_URL || `http://localhost:${DEFAULT_BACKEND_PORT}`;
    return {
      httpOrigin: origin,
      wsOrigin: origin.replace(/^http/i, 'ws'),
      token: undefined as string | undefined,
    };
  }

  const token = new URLSearchParams(window.location.search).get('token') ?? undefined;

  if (import.meta.env?.VITE_BFF_API_URL) {
    const explicit = new URL(import.meta.env.VITE_BFF_API_URL, window.location.origin).toString();
    return {
      httpOrigin: explicit,
      wsOrigin: explicit.replace(/^http/i, 'ws'),
      token,
    };
  }

  const protocol = window.location.protocol;
  const backendHost = resolveBackendHost(window.location.host);
  const httpOrigin = `${protocol}//${backendHost}`;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  const wsOrigin = `${wsProtocol}//${backendHost}`;

  return {
    httpOrigin,
    wsOrigin,
    token,
  };
}

const BACKEND_CONFIG = deriveBackendConfig();

export const BFF_HTTP_ORIGIN = BACKEND_CONFIG.httpOrigin;
export const BFF_WS_ORIGIN = BACKEND_CONFIG.wsOrigin;
export const BFF_TOKEN = BACKEND_CONFIG.token;

export function buildBackendHttpUrl(path: string, searchParams?: Record<string, string>): string {
  const url = new URL(path, BFF_HTTP_ORIGIN);
  if (BFF_TOKEN) {
    url.searchParams.set('token', BFF_TOKEN);
  }
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}

export function buildBackendWsUrl(path: string, searchParams?: Record<string, string>): string {
  const url = new URL(path, BFF_WS_ORIGIN);
  if (BFF_TOKEN) {
    url.searchParams.set('token', BFF_TOKEN);
  }
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }
  return url.toString();
}
