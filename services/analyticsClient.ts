import { JobAnalytics } from '../types.ts';
import { buildBackendHttpUrl } from '../config.ts';

interface AnalyticsResponse {
  ready: boolean;
  analytics: JobAnalytics | null;
  status: 'processing' | 'completed' | 'failed';
}

const cache = new Map<string, JobAnalytics>();

export async function fetchJobAnalytics(jobId?: string): Promise<AnalyticsResponse> {
  if (!jobId) {
    return { ready: false, analytics: null, status: 'failed' };
  }

  if (cache.has(jobId)) {
    return { ready: true, analytics: cache.get(jobId)!, status: 'completed' };
  }

  const response = await fetch(buildBackendHttpUrl(`/api/jobs/${jobId}/analytics`));
  if (response.status === 202) {
    const body = await response.json();
    return { ready: false, analytics: null, status: body.status || 'processing' };
  }

  if (!response.ok) {
    throw new Error(`Falha ao buscar analytics (${response.status})`);
  }

  const data = await response.json() as JobAnalytics;
  cache.set(jobId, data);
  return { ready: true, analytics: data, status: 'completed' };
}

export function primeAnalyticsCache(jobId: string, analytics: JobAnalytics) {
  if (jobId && analytics) {
    cache.set(jobId, analytics);
  }
}
