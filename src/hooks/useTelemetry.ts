// Telemetry state management with Zustand

import { create } from 'zustand';
import {
  TelemetryEvent,
  TelemetryMetrics,
  BackoffDataPoint,
  BackoffAnalysis,
  ExecutionSummary,
} from '@/types/telemetry';

interface TelemetryState {
  // Current execution
  executionId: string | null;
  isRunning: boolean;

  // Events and metrics
  events: TelemetryEvent[];
  metrics: TelemetryMetrics;
  backoffData: BackoffDataPoint[];
  backoffAnalysis: BackoffAnalysis | null;

  // Historical data for charts
  metricsHistory: Array<{ timestamp: number; metrics: Partial<TelemetryMetrics> }>;

  // Summary after completion
  summary: ExecutionSummary | null;

  // Counts for quick access
  conflictCount: number;
  retryCount: number;
  transactionCount: number;

  // Actions
  startExecution: (executionId: string) => void;
  addEvent: (event: TelemetryEvent) => void;
  updateMetrics: (metrics: Partial<TelemetryMetrics>) => void;
  addBackoffData: (data: BackoffDataPoint) => void;
  setBackoffAnalysis: (analysis: BackoffAnalysis) => void;
  finishExecution: (summary: ExecutionSummary) => void;
  reset: () => void;
}

const initialMetrics: TelemetryMetrics = {
  // Core metrics
  conflictsPerSec: 0,
  avgLatencyMs: 0,
  throughput: 0,
  successRate: 1,
  retryRate: 0,

  // Latency percentiles
  p50LatencyMs: 0,
  p95LatencyMs: 0,
  p99LatencyMs: 0,

  // Transaction counts
  totalTransactions: 0,
  committedCount: 0,
  abortedCount: 0,
  totalConflicts: 0,
  totalRetries: 0,

  // Timing
  totalDurationMs: 0,
  avgTransactionMs: 0,

  // Concurrency
  concurrentThreads: 1,
  peakConcurrency: 1,

  // Hotspots
  conflictHotspots: [],

  // Retry distribution
  retryDistribution: [],
};

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  executionId: null,
  isRunning: false,
  events: [],
  metrics: initialMetrics,
  backoffData: [],
  backoffAnalysis: null,
  metricsHistory: [],
  summary: null,
  conflictCount: 0,
  retryCount: 0,
  transactionCount: 0,

  startExecution: (executionId) => {
    set({
      executionId,
      isRunning: true,
      events: [],
      metrics: initialMetrics,
      backoffData: [],
      backoffAnalysis: null,
      metricsHistory: [],
      summary: null,
      conflictCount: 0,
      retryCount: 0,
      transactionCount: 0,
    });
  },

  addEvent: (event) => {
    set((state) => {
      const newEvents = [...state.events, event].slice(-1000);

      let conflictCount = state.conflictCount;
      let retryCount = state.retryCount;
      let transactionCount = state.transactionCount;

      if (event.type === 'conflict') conflictCount++;
      if (event.type === 'retry') retryCount++;
      if (event.type === 'start') transactionCount++;

      return {
        events: newEvents,
        conflictCount,
        retryCount,
        transactionCount,
      };
    });
  },

  updateMetrics: (partialMetrics) => {
    set((state) => {
      const mergedMetrics = { ...state.metrics, ...partialMetrics };
      return {
        metrics: mergedMetrics,
        metricsHistory: [
          ...state.metricsHistory.slice(-59),
          { timestamp: Date.now(), metrics: mergedMetrics },
        ],
      };
    });
  },

  addBackoffData: (data) => {
    set((state) => ({
      backoffData: [...state.backoffData.slice(-499), data],
    }));
  },

  setBackoffAnalysis: (analysis) => {
    set({ backoffAnalysis: analysis });
  },

  finishExecution: (summary) => {
    set({
      isRunning: false,
      summary,
    });
  },

  reset: () => {
    set({
      executionId: null,
      isRunning: false,
      events: [],
      metrics: initialMetrics,
      backoffData: [],
      backoffAnalysis: null,
      metricsHistory: [],
      summary: null,
      conflictCount: 0,
      retryCount: 0,
      transactionCount: 0,
    });
  },
}));

// Selector hooks for specific data
export const useConflictCount = () => useTelemetryStore((state) => state.conflictCount);
export const useRetryCount = () => useTelemetryStore((state) => state.retryCount);
export const useIsRunning = () => useTelemetryStore((state) => state.isRunning);
export const useMetrics = () => useTelemetryStore((state) => state.metrics);
export const useMetricsHistory = () => useTelemetryStore((state) => state.metricsHistory);
export const useBackoffAnalysis = () => useTelemetryStore((state) => state.backoffAnalysis);
