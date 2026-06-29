// Aurora DSQL Transaction Monitor
// Tracks transaction lifecycle and collects metrics

import { v4 as uuidv4 } from 'uuid';
import {
  TelemetryEvent,
  TransactionStartEvent,
  QueryEvent,
  ConflictEvent,
  RetryEvent,
  TransactionEndEvent,
  ConflictCode,
} from '@/types/telemetry';
import { DSQLTransactionState, DSQLError } from '@/types/dsql';

export type TransactionMonitorCallback = (event: TelemetryEvent) => void;

interface MonitoredTransaction {
  txnId: string;
  startedAt: number;
  events: TelemetryEvent[];
  queryCount: number;
  retryCount: number;
  conflictCount: number;
}

const activeTransactions = new Map<string, MonitoredTransaction>();
const subscribers = new Set<TransactionMonitorCallback>();

export function subscribe(callback: TransactionMonitorCallback): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

function emit(event: TelemetryEvent): void {
  subscribers.forEach((callback) => {
    try {
      callback(event);
    } catch (error) {
      console.error('Error in telemetry subscriber:', error);
    }
  });
}

export function startTransaction(state: DSQLTransactionState): void {
  const monitored: MonitoredTransaction = {
    txnId: state.txnId,
    startedAt: state.startedAt,
    events: [],
    queryCount: 0,
    retryCount: 0,
    conflictCount: 0,
  };

  activeTransactions.set(state.txnId, monitored);

  const event: TransactionStartEvent = {
    txnId: state.txnId,
    timestamp: state.startedAt,
    type: 'start',
  };

  monitored.events.push(event);
  emit(event);
}

export function recordQuery(
  txnId: string,
  sql: string,
  durationMs: number,
  rowCount?: number
): void {
  const monitored = activeTransactions.get(txnId);
  if (!monitored) return;

  monitored.queryCount++;

  const event: QueryEvent = {
    txnId,
    timestamp: Date.now(),
    type: 'query',
    sql: sanitizeSql(sql),
    durationMs,
    rowCount,
  };

  monitored.events.push(event);
  emit(event);
}

export function recordConflict(
  txnId: string,
  error: DSQLError,
  key?: string
): void {
  const monitored = activeTransactions.get(txnId);
  if (!monitored) return;

  monitored.conflictCount++;

  const code = error.code as ConflictCode;
  const event: ConflictEvent = {
    txnId,
    timestamp: Date.now(),
    type: 'conflict',
    code,
    subcode: error.dsqlCode,
    key,
    message: error.message,
  };

  monitored.events.push(event);
  emit(event);
}

export function recordRetry(
  txnId: string,
  attempt: number,
  delayMs: number,
  reason: string
): void {
  const monitored = activeTransactions.get(txnId);
  if (!monitored) return;

  monitored.retryCount++;

  const event: RetryEvent = {
    txnId,
    timestamp: Date.now(),
    type: 'retry',
    attempt,
    delayMs,
    reason,
  };

  monitored.events.push(event);
  emit(event);
}

export function endTransaction(
  txnId: string,
  status: 'commit' | 'abort'
): void {
  const monitored = activeTransactions.get(txnId);
  if (!monitored) return;

  const event: TransactionEndEvent = {
    txnId,
    timestamp: Date.now(),
    type: status,
    totalMs: Date.now() - monitored.startedAt,
    retryCount: monitored.retryCount,
  };

  monitored.events.push(event);
  emit(event);

  // Keep transaction data for a short time for analysis
  setTimeout(() => {
    activeTransactions.delete(txnId);
  }, 60000);
}

export function getTransactionEvents(txnId: string): TelemetryEvent[] {
  return activeTransactions.get(txnId)?.events || [];
}

export function getActiveTransactionCount(): number {
  return activeTransactions.size;
}

export function getTransactionStats(txnId: string): {
  duration: number;
  queryCount: number;
  retryCount: number;
  conflictCount: number;
} | null {
  const monitored = activeTransactions.get(txnId);
  if (!monitored) return null;

  return {
    duration: Date.now() - monitored.startedAt,
    queryCount: monitored.queryCount,
    retryCount: monitored.retryCount,
    conflictCount: monitored.conflictCount,
  };
}

export function clearAllTransactions(): void {
  activeTransactions.clear();
}

// Sanitize SQL to remove sensitive data before logging
function sanitizeSql(sql: string): string {
  // Remove potential passwords or tokens
  return sql
    .replace(/password\s*=\s*'[^']*'/gi, "password='***'")
    .replace(/token\s*=\s*'[^']*'/gi, "token='***'")
    .replace(/secret\s*=\s*'[^']*'/gi, "secret='***'");
}

// Create a monitored transaction wrapper
export function createMonitoredTransaction() {
  const txnId = uuidv4();
  let started = false;

  return {
    txnId,

    start(): void {
      if (started) return;
      started = true;
      startTransaction({
        txnId,
        status: 'active',
        startedAt: Date.now(),
        isolationLevel: 'repeatable_read',
        readOnly: false,
        queryCount: 0,
      });
    },

    query(sql: string, durationMs: number, rowCount?: number): void {
      recordQuery(txnId, sql, durationMs, rowCount);
    },

    conflict(error: DSQLError, key?: string): void {
      recordConflict(txnId, error, key);
    },

    retry(attempt: number, delayMs: number, reason: string): void {
      recordRetry(txnId, attempt, delayMs, reason);
    },

    commit(): void {
      endTransaction(txnId, 'commit');
    },

    abort(): void {
      endTransaction(txnId, 'abort');
    },

    getEvents(): TelemetryEvent[] {
      return getTransactionEvents(txnId);
    },
  };
}
