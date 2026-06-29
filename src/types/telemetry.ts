// Telemetry types for Zero-Lock Studio

export type TransactionStatus = 'pending' | 'running' | 'committed' | 'aborted' | 'retrying';

export type ConflictCode = '40001' | 'OC000' | 'OC001';

export interface TransactionEvent {
  txnId: string;
  timestamp: number;
  type: 'start' | 'query' | 'conflict' | 'retry' | 'commit' | 'abort';
}

export interface TransactionStartEvent extends TransactionEvent {
  type: 'start';
}

export interface QueryEvent extends TransactionEvent {
  type: 'query';
  sql: string;
  durationMs: number;
  rowCount?: number;
}

export interface ConflictEvent extends TransactionEvent {
  type: 'conflict';
  code: ConflictCode;
  subcode?: string;
  key?: string;
  message: string;
}

export interface RetryEvent extends TransactionEvent {
  type: 'retry';
  attempt: number;
  delayMs: number;
  reason: string;
}

export interface TransactionEndEvent extends TransactionEvent {
  type: 'commit' | 'abort';
  totalMs: number;
  retryCount: number;
}

export type TelemetryEvent =
  | TransactionStartEvent
  | QueryEvent
  | ConflictEvent
  | RetryEvent
  | TransactionEndEvent;

export interface TelemetryMetrics {
  // Core metrics
  conflictsPerSec: number;
  avgLatencyMs: number;
  throughput: number; // transactions per second
  successRate: number; // 0-1
  retryRate: number; // average retries per transaction

  // Latency percentiles
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;

  // Transaction counts
  totalTransactions: number;
  committedCount: number;
  abortedCount: number;
  totalConflicts: number;
  totalRetries: number;

  // Timing
  totalDurationMs: number;
  avgTransactionMs: number;

  // Concurrency
  concurrentThreads: number;
  peakConcurrency: number;

  // Hotspots (which keys conflict most)
  conflictHotspots: { key: string; count: number }[];

  // Retry distribution
  retryDistribution: { attempts: number; count: number }[];
}

export interface BackoffDataPoint {
  attempt: number;
  delayMs: number;
  timestamp: number;
  txnId: string;
}

export interface BackoffAnalysis {
  isExponential: boolean;
  hasJitter: boolean;
  baseDelay: number;
  multiplier: number;
  maxDelay: number;
  retryStormRisk: 'low' | 'medium' | 'high';
  recommendation?: string;
}

export interface IntegrityCheck {
  txnId: string;
  timestamp: number;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  operation: string;
  valid: boolean;
  anomaly?: 'lost_update' | 'write_skew' | 'dirty_read' | 'none';
}

export interface ExecutionSummary {
  executionId: string;
  startTime: number;
  endTime: number;
  totalTransactions: number;
  committedCount: number;
  abortedCount: number;
  totalConflicts: number;
  totalRetries: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  throughput: number;
  backoffAnalysis: BackoffAnalysis;
  integrityChecks: IntegrityCheck[];
}

export interface TelemetryStore {
  executionId: string | null;
  isRunning: boolean;
  events: TelemetryEvent[];
  metrics: TelemetryMetrics;
  backoffData: BackoffDataPoint[];
  summary: ExecutionSummary | null;

  // Actions
  startExecution: (executionId: string) => void;
  addEvent: (event: TelemetryEvent) => void;
  updateMetrics: (metrics: Partial<TelemetryMetrics>) => void;
  addBackoffData: (data: BackoffDataPoint) => void;
  finishExecution: (summary: ExecutionSummary) => void;
  reset: () => void;
}
