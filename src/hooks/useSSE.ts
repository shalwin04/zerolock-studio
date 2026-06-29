// Server-Sent Events hook for real-time telemetry

import { useEffect, useRef, useState, useCallback } from 'react';
import { TelemetryEvent, TelemetryMetrics, BackoffAnalysis } from '@/types/telemetry';

interface SSEState {
  connected: boolean;
  events: TelemetryEvent[];
  metrics: Partial<TelemetryMetrics> | null;
  backoffAnalysis: BackoffAnalysis | null;
  error: string | null;
}

export function useSSE(executionId: string | null) {
  const [state, setState] = useState<SSEState>({
    connected: false,
    events: [],
    metrics: null,
    backoffAnalysis: null,
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!executionId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/telemetry?executionId=${executionId}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', (e) => {
      setState((prev) => ({
        ...prev,
        connected: true,
        error: null,
      }));
    });

    eventSource.addEventListener('metrics', (e) => {
      const metrics = JSON.parse(e.data) as Partial<TelemetryMetrics>;
      setState((prev) => ({
        ...prev,
        metrics,
      }));
    });

    // Transaction events
    const eventTypes = ['start', 'query', 'conflict', 'retry', 'commit', 'abort'];
    eventTypes.forEach((type) => {
      eventSource.addEventListener(type, (e) => {
        const event = JSON.parse(e.data) as TelemetryEvent;
        setState((prev) => ({
          ...prev,
          events: [...prev.events.slice(-999), event], // Keep last 1000 events
        }));
      });
    });

    eventSource.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      setState((prev) => ({
        ...prev,
        backoffAnalysis: data.backoffAnalysis,
      }));
      eventSource.close();
    });

    eventSource.onerror = () => {
      setState((prev) => ({
        ...prev,
        connected: false,
        error: 'Connection lost',
      }));
    };
  }, [executionId]);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      connected: false,
    }));
  }, []);

  const reset = useCallback(() => {
    setState({
      connected: false,
      events: [],
      metrics: null,
      backoffAnalysis: null,
      error: null,
    });
  }, []);

  useEffect(() => {
    if (executionId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [executionId, connect, disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    reset,
  };
}
