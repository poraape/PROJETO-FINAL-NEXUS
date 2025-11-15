import { useEffect, useState } from 'react';
import { JobAnalytics } from '../types.ts';
import { fetchJobAnalytics } from '../services/analyticsClient.ts';

interface AnalyticsState {
  data: JobAnalytics | null;
  loading: boolean;
  status: 'idle' | 'processing' | 'completed' | 'failed';
  error: string | null;
}

const POLLING_INTERVAL = 4000;

export function useJobAnalytics(jobId?: string | null): AnalyticsState {
  const [state, setState] = useState<AnalyticsState>({ data: null, loading: Boolean(jobId), status: 'idle', error: null });

  useEffect(() => {
    if (!jobId) {
      setState({ data: null, loading: false, status: 'idle', error: null });
      return;
    }

    let cancelled = false;
    let timeoutId: NodeJS.Timeout | null = null;

    const fetchData = async () => {
      try {
        const result = await fetchJobAnalytics(jobId);
        if (cancelled) return;
        if (result.ready && result.analytics) {
          setState({ data: result.analytics, loading: false, status: 'completed', error: null });
        } else {
          setState(prev => ({ ...prev, loading: true, status: 'processing' }));
          timeoutId = setTimeout(fetchData, POLLING_INTERVAL);
        }
      } catch (error) {
        if (cancelled) return;
        setState({
          data: null,
          loading: false,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Falha ao carregar analytics.',
        });
      }
    };

    fetchData();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [jobId]);

  return state;
}
