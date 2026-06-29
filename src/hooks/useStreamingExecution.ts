// Hook for streaming code execution with real-time SSE updates
import { useCallback, useRef } from 'react';
import { TelemetryEvent, BackoffDataPoint, TelemetryMetrics } from '@/types/telemetry';
import { ChaosConfig } from '@/types/chaos';

interface StreamingExecutionOptions {
  onEvent: (event: TelemetryEvent) => void;
  onMetrics: (metrics: Partial<TelemetryMetrics>) => void;
  onBackoffData: (data: BackoffDataPoint) => void;
  onComplete: (result: {
    success: boolean;
    executionId: string;
    result?: {
      output: unknown;
      duration: number;
      transactionCount: number;
      queryCount: number;
      conflictCount: number;
      retryCount: number;
      avgLatency: number;
      rowsAffected: number;
    };
    error?: { code: string; message: string };
    finalMetrics?: Partial<TelemetryMetrics>;
    backoffData?: BackoffDataPoint[];
  }) => void;
  onError: (error: string) => void;
}

interface ExecuteParams {
  code: string;
  language: 'typescript' | 'sql';
  chaosConfig: ChaosConfig;
  connection?: {
    clusterEndpoint?: string;
    region?: string;
    database?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

export function useStreamingExecution() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(async (
    params: ExecuteParams,
    options: StreamingExecutionOptions
  ) => {
    // Abort any existing execution
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/execute/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const error = await response.json();
        options.onError(error.error || 'Request failed');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        options.onError('No response body');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7);
          } else if (line.startsWith('data: ')) {
            currentData = line.slice(6);

            if (currentEvent && currentData) {
              try {
                const data = JSON.parse(currentData);
                handleSSEEvent(currentEvent, data, options);
              } catch (e) {
                console.error('Failed to parse SSE data:', e);
              }
              currentEvent = '';
              currentData = '';
            }
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        return; // Intentionally aborted
      }
      options.onError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return { execute, abort };
}

function handleSSEEvent(
  eventType: string,
  data: unknown,
  options: StreamingExecutionOptions
) {
  switch (eventType) {
    case 'connected':
      // Connection established
      break;

    case 'start':
    case 'query':
    case 'conflict':
    case 'retry':
    case 'commit':
    case 'abort':
      options.onEvent(data as TelemetryEvent);

      // Also extract backoff data from retry events
      if (eventType === 'retry') {
        const retryEvent = data as TelemetryEvent & { attempt: number; delayMs: number };
        options.onBackoffData({
          attempt: retryEvent.attempt,
          delayMs: retryEvent.delayMs,
          timestamp: retryEvent.timestamp,
          txnId: retryEvent.txnId,
        });
      }
      break;

    case 'metrics':
      options.onMetrics(data as Partial<TelemetryMetrics>);
      break;

    case 'done':
      const result = data as {
        success: boolean;
        executionId: string;
        result?: {
          output: unknown;
          duration: number;
          transactionCount: number;
          queryCount: number;
          conflictCount: number;
          retryCount: number;
          avgLatency: number;
          rowsAffected: number;
        };
        error?: { code: string; message: string };
        finalMetrics?: Partial<TelemetryMetrics>;
        backoffData?: BackoffDataPoint[];
      };
      options.onComplete(result);
      break;

    case 'error':
      const errorData = data as { message: string };
      options.onError(errorData.message);
      break;
  }
}
