// Real Execution Engine for Zero-Lock Studio
// Executes transaction code against live Aurora DSQL

import { v4 as uuidv4 } from 'uuid';
import { Pool, PoolClient } from 'pg';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { ChaosConfig } from '@/types/chaos';
import {
  TelemetryEvent,
  TelemetryMetrics,
  BackoffDataPoint,
} from '@/types/telemetry';
import { DSQLError, parseDSQLError, isDSQLRetryableError } from '@/types/dsql';

export interface ExecutionRequest {
  code: string;
  language: 'typescript' | 'sql';
  chaosConfig: ChaosConfig;
  timeout?: number;
}

export interface ExecutionResult {
  executionId: string;
  success: boolean;
  output?: unknown;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  metrics: {
    duration: number;
    transactionCount: number;
    queryCount: number;
    conflictCount: number;
    retryCount: number;
    avgLatency: number;
    rowsAffected: number;
  };
  events: TelemetryEvent[];
  backoffData: BackoffDataPoint[];
}

// Connection pool singleton
let pool: Pool | null = null;
let poolExpiresAt: number = 0;

// Active executions for SSE streaming
const activeExecutions = new Map<string, {
  startedAt: number;
  events: TelemetryEvent[];
  backoffData: BackoffDataPoint[];
  isRunning: boolean;
  emitEvent: (event: TelemetryEvent) => void;
}>();

async function getAuthToken(): Promise<string> {
  const hostname = process.env.AWS_DSQL_CLUSTER_ENDPOINT;
  const region = process.env.AWS_REGION || 'us-east-1';

  if (!hostname) {
    throw new Error('AWS_DSQL_CLUSTER_ENDPOINT not configured');
  }

  const signer = new DsqlSigner({ hostname, region });
  return signer.getDbConnectAdminAuthToken();
}

async function getPool(): Promise<Pool> {
  const now = Date.now();

  // Refresh pool if token is expired (tokens last 15 min, refresh at 14 min)
  if (pool && poolExpiresAt > now) {
    return pool;
  }

  if (pool) {
    await pool.end().catch(() => {});
  }

  const token = await getAuthToken();

  pool = new Pool({
    host: process.env.AWS_DSQL_CLUSTER_ENDPOINT,
    port: 5432,
    database: process.env.AWS_DSQL_DATABASE || 'postgres',
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Token expires in 15 min, refresh at 14 min
  poolExpiresAt = now + 14 * 60 * 1000;

  return pool;
}

// Main execution function
export async function executeCode(request: ExecutionRequest): Promise<ExecutionResult> {
  const executionId = `exec_${uuidv4()}`;
  const startTime = Date.now();
  const timeout = Math.min(request.timeout || 30000, 60000);

  const events: TelemetryEvent[] = [];
  const backoffData: BackoffDataPoint[] = [];
  let transactionCount = 0;
  let queryCount = 0;
  let conflictCount = 0;
  let retryCount = 0;
  let totalLatency = 0;
  let rowsAffected = 0;

  // Register execution for SSE
  const execution = {
    startedAt: startTime,
    events,
    backoffData,
    isRunning: true,
    emitEvent: (event: TelemetryEvent) => {
      events.push(event);
    },
  };
  activeExecutions.set(executionId, execution);

  try {
    const dbPool = await getPool();

    // Determine number of concurrent transactions to run
    const concurrentThreads = request.chaosConfig.enabled
      ? Math.max(1, Math.min(request.chaosConfig.concurrentThreads, 50))
      : 1;

    // Parse and execute code
    if (request.language === 'sql') {
      // For SQL, run concurrent copies
      const promises: Promise<{
        queryCount: number;
        conflictCount: number;
        retryCount: number;
        totalLatency: number;
        rowsAffected: number;
        backoffData: BackoffDataPoint[];
        rows: unknown[];
      }>[] = [];

      for (let i = 0; i < concurrentThreads; i++) {
        promises.push(
          executeSQLWithChaos(
            dbPool,
            request.code,
            request.chaosConfig,
            executionId,
            execution.emitEvent
          )
        );
      }

      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          queryCount += result.value.queryCount;
          conflictCount += result.value.conflictCount;
          retryCount += result.value.retryCount;
          totalLatency += result.value.totalLatency;
          rowsAffected += result.value.rowsAffected;
          transactionCount++;
          backoffData.push(...result.value.backoffData);
        }
      }

      return {
        executionId,
        success: true,
        output: { threadsRun: concurrentThreads, completed: transactionCount },
        metrics: {
          duration: Date.now() - startTime,
          transactionCount,
          queryCount,
          conflictCount,
          retryCount,
          avgLatency: queryCount > 0 ? totalLatency / queryCount : 0,
          rowsAffected,
        },
        events,
        backoffData,
      };
    } else {
      // TypeScript/transaction execution - run concurrently
      const promises: Promise<{
        output: unknown;
        transactionCount: number;
        queryCount: number;
        conflictCount: number;
        retryCount: number;
        totalLatency: number;
        rowsAffected: number;
        backoffData: BackoffDataPoint[];
      }>[] = [];

      for (let i = 0; i < concurrentThreads; i++) {
        promises.push(
          executeTransactionCode(
            dbPool,
            request.code,
            request.chaosConfig,
            executionId,
            execution.emitEvent
          )
        );
      }

      const results = await Promise.allSettled(promises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          transactionCount += result.value.transactionCount;
          queryCount += result.value.queryCount;
          conflictCount += result.value.conflictCount;
          retryCount += result.value.retryCount;
          totalLatency += result.value.totalLatency;
          rowsAffected += result.value.rowsAffected;
          backoffData.push(...result.value.backoffData);
        }
      }

      return {
        executionId,
        success: true,
        output: { threadsRun: concurrentThreads, completed: transactionCount },
        metrics: {
          duration: Date.now() - startTime,
          transactionCount,
          queryCount,
          conflictCount,
          retryCount,
          avgLatency: queryCount > 0 ? totalLatency / queryCount : 0,
          rowsAffected,
        },
        events,
        backoffData,
      };
    }
  } catch (error) {
    const dsqlError = parseDSQLError(error);

    return {
      executionId,
      success: false,
      error: {
        code: dsqlError.code,
        message: dsqlError.message,
        details: {
          severity: dsqlError.severity,
          hint: dsqlError.hint,
          isRetryable: dsqlError.isRetryable,
          dsqlCode: dsqlError.dsqlCode,
        },
      },
      metrics: {
        duration: Date.now() - startTime,
        transactionCount,
        queryCount,
        conflictCount,
        retryCount,
        avgLatency: queryCount > 0 ? totalLatency / queryCount : 0,
        rowsAffected,
      },
      events,
      backoffData,
    };
  } finally {
    execution.isRunning = false;
    // Keep execution data for a short time for late SSE connections
    setTimeout(() => activeExecutions.delete(executionId), 60000);
  }
}

// Execute raw SQL with chaos injection
async function executeSQLWithChaos(
  dbPool: Pool,
  sql: string,
  chaosConfig: ChaosConfig,
  executionId: string,
  emitEvent: (event: TelemetryEvent) => void
): Promise<{
  rows: unknown[];
  queryCount: number;
  conflictCount: number;
  retryCount: number;
  totalLatency: number;
  rowsAffected: number;
  backoffData: BackoffDataPoint[];
}> {
  const txnId = uuidv4();
  const backoffData: BackoffDataPoint[] = [];
  let queryCount = 0;
  let conflictCount = 0;
  let retryCount = 0;
  let totalLatency = 0;
  let rowsAffected = 0;

  emitEvent({
    txnId,
    timestamp: Date.now(),
    type: 'start',
  });

  // Split SQL into statements
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const results: unknown[] = [];
  const client = await dbPool.connect();

  try {
    // Start transaction if multiple statements
    if (statements.length > 1) {
      await client.query('BEGIN');
    }

    for (const statement of statements) {
      // Inject chaos latency
      if (chaosConfig.enabled && chaosConfig.latencyMs > 0) {
        await sleep(chaosConfig.latencyMs);
      }

      // Maybe inject synthetic conflict
      if (chaosConfig.enabled && Math.random() * 100 < chaosConfig.conflictProbability) {
        conflictCount++;
        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'conflict',
          code: '40001',
          subcode: 'OC000',
          message: 'Synthetic conflict injected by chaos',
        });

        // If we're injecting conflicts, simulate retry
        retryCount++;
        const delay = Math.random() * Math.min(5000, 50 * Math.pow(2, retryCount));
        backoffData.push({
          attempt: retryCount,
          delayMs: delay,
          timestamp: Date.now(),
          txnId,
        });
        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'retry',
          attempt: retryCount,
          delayMs: delay,
          reason: 'Synthetic conflict',
        });
        await sleep(delay);
      }

      // Execute statement
      const queryStart = Date.now();
      try {
        const result = await client.query(statement);
        const duration = Date.now() - queryStart;

        queryCount++;
        totalLatency += duration;
        rowsAffected += result.rowCount || 0;

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'query',
          sql: statement.substring(0, 100),
          durationMs: duration,
          rowCount: result.rowCount || 0,
        });

        results.push(result.rows);
      } catch (error) {
        const dsqlError = parseDSQLError(error);

        if (dsqlError.code === '40001') {
          conflictCount++;
          emitEvent({
            txnId,
            timestamp: Date.now(),
            type: 'conflict',
            code: dsqlError.code,
            subcode: dsqlError.dsqlCode,
            message: dsqlError.message,
          });
        }
        throw error;
      }
    }

    // Commit if multi-statement
    if (statements.length > 1) {
      await client.query('COMMIT');
    }

    emitEvent({
      txnId,
      timestamp: Date.now(),
      type: 'commit',
      totalMs: Date.now() - (emitEvent as any).startTime || Date.now(),
      retryCount,
    });

    return {
      rows: results.flat(),
      queryCount,
      conflictCount,
      retryCount,
      totalLatency,
      rowsAffected,
      backoffData,
    };
  } catch (error) {
    if (statements.length > 1) {
      await client.query('ROLLBACK').catch(() => {});
    }

    emitEvent({
      txnId,
      timestamp: Date.now(),
      type: 'abort',
      totalMs: Date.now() - (emitEvent as any).startTime || Date.now(),
      retryCount,
    });

    throw error;
  } finally {
    client.release();
  }
}

// Execute TypeScript transaction code (parsed patterns)
async function executeTransactionCode(
  dbPool: Pool,
  code: string,
  chaosConfig: ChaosConfig,
  executionId: string,
  emitEvent: (event: TelemetryEvent) => void
): Promise<{
  output: unknown;
  transactionCount: number;
  queryCount: number;
  conflictCount: number;
  retryCount: number;
  totalLatency: number;
  rowsAffected: number;
  backoffData: BackoffDataPoint[];
}> {
  // Parse code to determine operation type
  const operation = parseCodePattern(code);
  const backoffData: BackoffDataPoint[] = [];

  let transactionCount = 0;
  let queryCount = 0;
  let conflictCount = 0;
  let retryCount = 0;
  let totalLatency = 0;
  let rowsAffected = 0;

  const client = await dbPool.connect();

  try {
    // Execute based on detected pattern
    switch (operation.type) {
      case 'transfer': {
        const result = await executeTransferWithRetry(
          client,
          chaosConfig,
          emitEvent,
          backoffData
        );
        transactionCount = result.transactionCount;
        queryCount = result.queryCount;
        conflictCount = result.conflictCount;
        retryCount = result.retryCount;
        totalLatency = result.totalLatency;
        rowsAffected = result.rowsAffected;
        return { output: result.output, transactionCount, queryCount, conflictCount, retryCount, totalLatency, rowsAffected, backoffData };
      }

      case 'counter': {
        const result = await executeCounterIncrementWithRetry(
          client,
          chaosConfig,
          emitEvent,
          backoffData
        );
        transactionCount = result.transactionCount;
        queryCount = result.queryCount;
        conflictCount = result.conflictCount;
        retryCount = result.retryCount;
        totalLatency = result.totalLatency;
        rowsAffected = result.rowsAffected;
        return { output: result.output, transactionCount, queryCount, conflictCount, retryCount, totalLatency, rowsAffected, backoffData };
      }

      default: {
        // Execute as raw SQL
        const sqlResult = await executeSQLWithChaos(
          dbPool,
          extractSQLFromCode(code),
          chaosConfig,
          executionId,
          emitEvent
        );
        client.release();
        return {
          output: sqlResult.rows,
          transactionCount: 1,
          queryCount: sqlResult.queryCount,
          conflictCount: sqlResult.conflictCount,
          retryCount: sqlResult.retryCount,
          totalLatency: sqlResult.totalLatency,
          rowsAffected: sqlResult.rowsAffected,
          backoffData: sqlResult.backoffData,
        };
      }
    }
  } finally {
    client.release();
  }
}

// Execute balance transfer with proper retry logic
async function executeTransferWithRetry(
  client: PoolClient,
  chaosConfig: ChaosConfig,
  emitEvent: (event: TelemetryEvent) => void,
  backoffData: BackoffDataPoint[]
): Promise<{
  output: unknown;
  transactionCount: number;
  queryCount: number;
  conflictCount: number;
  retryCount: number;
  totalLatency: number;
  rowsAffected: number;
}> {
  const txnId = uuidv4();
  const MAX_RETRIES = 5;
  const BASE_DELAY = 50;
  const MAX_DELAY = 5000;

  let attempt = 0;
  let queryCount = 0;
  let conflictCount = 0;
  let totalLatency = 0;
  let rowsAffected = 0;

  emitEvent({ txnId, timestamp: Date.now(), type: 'start' });

  while (attempt <= MAX_RETRIES) {
    try {
      await client.query('BEGIN');

      // Inject latency if enabled
      if (chaosConfig.enabled && chaosConfig.latencyMs > 0) {
        await sleep(chaosConfig.latencyMs);
      }

      // Simulate transfer: read accounts, update balances
      const amount = 100;
      const fromId = '11111111-1111-1111-1111-111111111111'; // Alice
      const toId = '22222222-2222-2222-2222-222222222222';   // Bob

      // Read balances (FOR UPDATE to prevent write-skew)
      const start1 = Date.now();
      const accounts = await client.query(
        'SELECT id, balance FROM accounts WHERE id IN ($1, $2) FOR UPDATE',
        [fromId, toId]
      );
      totalLatency += Date.now() - start1;
      queryCount++;

      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'query',
        sql: 'SELECT...FROM accounts FOR UPDATE',
        durationMs: Date.now() - start1,
        rowCount: accounts.rowCount || 0,
      });

      // Maybe inject conflict
      if (chaosConfig.enabled && Math.random() * 100 < chaosConfig.conflictProbability) {
        throw { code: '40001', message: 'Synthetic OCC conflict', severity: 'ERROR' };
      }

      // Update balances
      const start2 = Date.now();
      await client.query(
        'UPDATE accounts SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
        [amount, fromId]
      );
      totalLatency += Date.now() - start2;
      queryCount++;
      rowsAffected++;

      const start3 = Date.now();
      await client.query(
        'UPDATE accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
        [amount, toId]
      );
      totalLatency += Date.now() - start3;
      queryCount++;
      rowsAffected++;

      await client.query('COMMIT');

      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'commit',
        totalMs: totalLatency,
        retryCount: attempt,
      });

      return {
        output: { transferred: amount, from: fromId, to: toId, success: true },
        transactionCount: 1,
        queryCount,
        conflictCount,
        retryCount: attempt,
        totalLatency,
        rowsAffected,
      };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => {});

      if (error.code === '40001' && attempt < MAX_RETRIES) {
        conflictCount++;
        attempt++;

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'conflict',
          code: '40001',
          subcode: 'OC000',
          message: error.message,
        });

        // Full jitter exponential backoff
        const maxDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attempt));
        const delay = Math.random() * maxDelay;

        backoffData.push({
          attempt,
          delayMs: delay,
          timestamp: Date.now(),
          txnId,
        });

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'retry',
          attempt,
          delayMs: delay,
          reason: error.message,
        });

        await sleep(delay);
        continue;
      }

      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'abort',
        totalMs: totalLatency,
        retryCount: attempt,
      });

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

// Execute counter increment with retry and chaos injection
async function executeCounterIncrementWithRetry(
  client: PoolClient,
  chaosConfig: ChaosConfig,
  emitEvent: (event: TelemetryEvent) => void,
  backoffData: BackoffDataPoint[]
): Promise<{
  output: unknown;
  transactionCount: number;
  queryCount: number;
  conflictCount: number;
  retryCount: number;
  totalLatency: number;
  rowsAffected: number;
}> {
  const txnId = uuidv4();
  const MAX_RETRIES = 5;
  const BASE_DELAY = 50;
  const MAX_DELAY = 5000;

  let attempt = 0;
  let queryCount = 0;
  let conflictCount = 0;
  let retryCount = 0;
  let totalLatency = 0;

  emitEvent({ txnId, timestamp: Date.now(), type: 'start' });

  while (attempt <= MAX_RETRIES) {
    try {
      // Inject latency if enabled
      if (chaosConfig.enabled && chaosConfig.latencyMs > 0) {
        await sleep(chaosConfig.latencyMs);
      }

      // Maybe inject synthetic conflict BEFORE the query
      if (chaosConfig.enabled && Math.random() * 100 < chaosConfig.conflictProbability) {
        throw { code: '40001', message: 'Synthetic OCC conflict on counter', severity: 'ERROR' };
      }

      // Atomic counter increment
      const start = Date.now();
      const result = await client.query(
        `UPDATE counters
         SET value = value + 1,
             update_count = update_count + 1,
             last_updated_at = NOW()
         WHERE id = 'hot_counter'
         RETURNING value`
      );
      totalLatency += Date.now() - start;
      queryCount++;

      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'query',
        sql: 'UPDATE counters SET value = value + 1',
        durationMs: Date.now() - start,
        rowCount: result.rowCount || 0,
      });

      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'commit',
        totalMs: totalLatency,
        retryCount: attempt,
      });

      return {
        output: { newValue: result.rows[0]?.value, success: true },
        transactionCount: 1,
        queryCount,
        conflictCount,
        retryCount: attempt,
        totalLatency,
        rowsAffected: result.rowCount || 0,
      };
    } catch (error: any) {
      // Handle conflict (40001)
      if (error.code === '40001' && attempt < MAX_RETRIES) {
        conflictCount++;
        attempt++;
        retryCount = attempt;

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'conflict',
          code: '40001',
          subcode: 'OC000',
          message: error.message,
        });

        // Full jitter exponential backoff
        const maxDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(2, attempt));
        const delay = Math.random() * maxDelay;

        backoffData.push({
          attempt,
          delayMs: delay,
          timestamp: Date.now(),
          txnId,
        });

        emitEvent({
          txnId,
          timestamp: Date.now(),
          type: 'retry',
          attempt,
          delayMs: delay,
          reason: error.message,
        });

        await sleep(delay);
        continue;
      }

      // Non-retryable error or max retries exceeded
      emitEvent({
        txnId,
        timestamp: Date.now(),
        type: 'abort',
        totalMs: totalLatency,
        retryCount: attempt,
      });

      throw error;
    }
  }

  throw new Error('Max retries exceeded');
}

// Parse code to detect operation pattern
function parseCodePattern(code: string): { type: string; params?: Record<string, unknown> } {
  const lower = code.toLowerCase();

  if (lower.includes('transfer') || (lower.includes('balance') && lower.includes('update'))) {
    return { type: 'transfer' };
  }

  if (lower.includes('counter') || lower.includes('increment')) {
    return { type: 'counter' };
  }

  if (lower.includes('insert')) {
    return { type: 'insert' };
  }

  return { type: 'custom' };
}

// Extract SQL from TypeScript code
function extractSQLFromCode(code: string): string {
  // Find SQL strings in template literals or query calls
  const sqlMatch = code.match(/`([^`]+)`/) || code.match(/'([^']+)'/) || code.match(/"([^"]+)"/);
  if (sqlMatch) {
    return sqlMatch[1];
  }
  return 'SELECT 1 as connected';
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Get execution state for SSE streaming
export function getExecutionState(executionId: string) {
  return activeExecutions.get(executionId);
}

// Get all active executions
export function getActiveExecutionCount(): number {
  return Array.from(activeExecutions.values()).filter((e) => e.isRunning).length;
}
