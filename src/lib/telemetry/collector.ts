// Telemetry Collector for Zero-Lock Studio
// Aggregates metrics and prepares data for streaming

import {
  TelemetryEvent,
  TelemetryMetrics,
  BackoffDataPoint,
  BackoffAnalysis,
  ExecutionSummary,
  IntegrityCheck,
} from '@/types/telemetry';

interface MetricsWindow {
  windowStart: number;
  windowSize: number; // ms
  conflictCount: number;
  transactionCount: number;
  retryCount: number;
  totalLatency: number;
  queryCount: number;
}

// Rolling metrics windows
const metricsWindows: MetricsWindow[] = [];
const WINDOW_SIZE_MS = 1000; // 1 second windows
const MAX_WINDOWS = 60; // Keep 60 seconds of history

// Backoff data for analysis
const backoffData: BackoffDataPoint[] = [];
const MAX_BACKOFF_POINTS = 500;

// Current execution context
let currentExecutionId: string | null = null;
let executionStartTime: number | null = null;

export function startCollection(executionId: string): void {
  currentExecutionId = executionId;
  executionStartTime = Date.now();
  metricsWindows.length = 0;
  backoffData.length = 0;
}

export function stopCollection(): string | null {
  const id = currentExecutionId;
  currentExecutionId = null;
  executionStartTime = null;
  return id;
}

export function recordEvent(event: TelemetryEvent): void {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_SIZE_MS) * WINDOW_SIZE_MS;

  // Find or create the current window
  let window = metricsWindows.find((w) => w.windowStart === windowStart);
  if (!window) {
    window = {
      windowStart,
      windowSize: WINDOW_SIZE_MS,
      conflictCount: 0,
      transactionCount: 0,
      retryCount: 0,
      totalLatency: 0,
      queryCount: 0,
    };
    metricsWindows.push(window);

    // Trim old windows
    while (metricsWindows.length > MAX_WINDOWS) {
      metricsWindows.shift();
    }
  }

  // Update metrics based on event type
  switch (event.type) {
    case 'start':
      window.transactionCount++;
      break;
    case 'conflict':
      window.conflictCount++;
      break;
    case 'retry':
      window.retryCount++;
      if ('delayMs' in event) {
        backoffData.push({
          attempt: event.attempt,
          delayMs: event.delayMs,
          timestamp: event.timestamp,
          txnId: event.txnId,
        });
        while (backoffData.length > MAX_BACKOFF_POINTS) {
          backoffData.shift();
        }
      }
      break;
    case 'query':
      window.queryCount++;
      if ('durationMs' in event) {
        window.totalLatency += event.durationMs;
      }
      break;
  }
}

export function getCurrentMetrics(): TelemetryMetrics {
  const now = Date.now();
  const recentWindows = metricsWindows.filter(
    (w) => now - w.windowStart < 10000 // Last 10 seconds
  );

  if (recentWindows.length === 0) {
    return {
      conflictsPerSec: 0,
      avgLatencyMs: 0,
      throughput: 0,
      successRate: 1,
      retryRate: 0,
    };
  }

  const totalConflicts = recentWindows.reduce((sum, w) => sum + w.conflictCount, 0);
  const totalTransactions = recentWindows.reduce((sum, w) => sum + w.transactionCount, 0);
  const totalRetries = recentWindows.reduce((sum, w) => sum + w.retryCount, 0);
  const totalLatency = recentWindows.reduce((sum, w) => sum + w.totalLatency, 0);
  const totalQueries = recentWindows.reduce((sum, w) => sum + w.queryCount, 0);

  const windowCount = recentWindows.length;
  const timeSpanSec = windowCount * (WINDOW_SIZE_MS / 1000);

  return {
    conflictsPerSec: totalConflicts / timeSpanSec,
    avgLatencyMs: totalQueries > 0 ? totalLatency / totalQueries : 0,
    throughput: totalTransactions / timeSpanSec,
    successRate:
      totalTransactions > 0
        ? Math.max(0, (totalTransactions - totalConflicts) / totalTransactions)
        : 1,
    retryRate: totalTransactions > 0 ? totalRetries / totalTransactions : 0,
  };
}

export function getBackoffData(): BackoffDataPoint[] {
  return [...backoffData];
}

export function analyzeBackoffPattern(): BackoffAnalysis {
  if (backoffData.length < 3) {
    return {
      isExponential: true,
      hasJitter: true,
      baseDelay: 50,
      multiplier: 2,
      maxDelay: 5000,
      retryStormRisk: 'low',
    };
  }

  // Group retries by transaction
  const byTxn = new Map<string, BackoffDataPoint[]>();
  for (const point of backoffData) {
    const existing = byTxn.get(point.txnId) || [];
    existing.push(point);
    byTxn.set(point.txnId, existing);
  }

  // Analyze each transaction's retry pattern
  let exponentialCount = 0;
  let fixedIntervalCount = 0;
  let hasJitterCount = 0;
  const delays: number[] = [];

  for (const [txnId, points] of byTxn) {
    if (points.length < 2) continue;

    // Sort by attempt
    points.sort((a, b) => a.attempt - b.attempt);

    // Check if delays are exponential
    let isExponential = true;
    let prevDelay = points[0].delayMs;

    for (let i = 1; i < points.length; i++) {
      const currentDelay = points[i].delayMs;
      delays.push(currentDelay);

      // Check if roughly doubling (with jitter tolerance)
      const expectedMin = prevDelay * 1.5;
      const expectedMax = prevDelay * 3;

      if (currentDelay < expectedMin || currentDelay > expectedMax) {
        isExponential = false;
      }

      prevDelay = currentDelay;
    }

    if (isExponential) {
      exponentialCount++;
    }

    // Check for jitter (variance in delays)
    const avgDelay = points.reduce((sum, p) => sum + p.delayMs, 0) / points.length;
    const variance =
      points.reduce((sum, p) => sum + Math.pow(p.delayMs - avgDelay, 2), 0) /
      points.length;
    const stdDev = Math.sqrt(variance);

    // Good jitter should have stdDev > 10% of mean
    if (stdDev > avgDelay * 0.1) {
      hasJitterCount++;
    } else {
      fixedIntervalCount++;
    }
  }

  const totalTxns = byTxn.size;
  const isExponential = totalTxns > 0 && exponentialCount / totalTxns > 0.7;
  const hasJitter = totalTxns > 0 && hasJitterCount / totalTxns > 0.5;

  // Estimate base delay and multiplier
  const sortedDelays = delays.sort((a, b) => a - b);
  const baseDelay = sortedDelays.length > 0 ? sortedDelays[0] : 50;
  const maxDelay = sortedDelays.length > 0 ? sortedDelays[sortedDelays.length - 1] : 5000;

  // Determine retry storm risk
  let retryStormRisk: 'low' | 'medium' | 'high' = 'low';
  if (!hasJitter) {
    retryStormRisk = 'high';
  } else if (!isExponential) {
    retryStormRisk = 'medium';
  }

  return {
    isExponential,
    hasJitter,
    baseDelay,
    multiplier: 2,
    maxDelay,
    retryStormRisk,
    recommendation: !hasJitter
      ? 'Add full jitter to your backoff: delay = random(0, min(cap, base * 2^attempt))'
      : !isExponential
      ? 'Use exponential backoff to reduce collision probability over time'
      : undefined,
  };
}

export function generateExecutionSummary(
  executionId: string,
  events: TelemetryEvent[]
): ExecutionSummary {
  const startEvent = events.find((e) => e.type === 'start');
  const endEvents = events.filter((e) => e.type === 'commit' || e.type === 'abort');

  const startTime = startEvent?.timestamp || Date.now();
  const endTime =
    endEvents.length > 0
      ? Math.max(...endEvents.map((e) => e.timestamp))
      : Date.now();

  const commits = events.filter((e) => e.type === 'commit').length;
  const aborts = events.filter((e) => e.type === 'abort').length;
  const conflicts = events.filter((e) => e.type === 'conflict').length;
  const retries = events.filter((e) => e.type === 'retry').length;

  // Calculate latencies
  const latencies = events
    .filter((e): e is TelemetryEvent & { durationMs: number } =>
      e.type === 'query' && 'durationMs' in e
    )
    .map((e) => e.durationMs);

  const sortedLatencies = latencies.sort((a, b) => a - b);
  const avgLatency =
    latencies.length > 0
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;

  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);
  const p99 = percentile(sortedLatencies, 99);

  const durationSec = (endTime - startTime) / 1000;
  const throughput = durationSec > 0 ? (commits + aborts) / durationSec : 0;

  return {
    executionId,
    startTime,
    endTime,
    totalTransactions: commits + aborts,
    committedCount: commits,
    abortedCount: aborts,
    totalConflicts: conflicts,
    totalRetries: retries,
    avgLatencyMs: avgLatency,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    throughput,
    backoffAnalysis: analyzeBackoffPattern(),
    integrityChecks: [], // Would be populated by integrity checker
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

export function getHistoricalMetrics(
  secondsBack: number
): Array<{ timestamp: number; metrics: TelemetryMetrics }> {
  const now = Date.now();
  const cutoff = now - secondsBack * 1000;

  return metricsWindows
    .filter((w) => w.windowStart >= cutoff)
    .map((w) => ({
      timestamp: w.windowStart,
      metrics: {
        conflictsPerSec: w.conflictCount / (WINDOW_SIZE_MS / 1000),
        avgLatencyMs: w.queryCount > 0 ? w.totalLatency / w.queryCount : 0,
        throughput: w.transactionCount / (WINDOW_SIZE_MS / 1000),
        successRate:
          w.transactionCount > 0
            ? (w.transactionCount - w.conflictCount) / w.transactionCount
            : 1,
        retryRate:
          w.transactionCount > 0 ? w.retryCount / w.transactionCount : 0,
      },
    }));
}
